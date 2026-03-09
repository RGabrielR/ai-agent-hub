"""
Generación de respuestas usando Gemini y DeepSeek.

Se soportan tres modos:
1. Vertex AI (por defecto) mediante service account.
2. API pública de Gemini cuando se define GENAI_API_KEY.
3. DeepSeek mediante API compatible con OpenAI (requiere DEEPSEEK_API_KEY).
"""
import os
import time
from typing import List, Dict, Any, Tuple, Optional
import logging

import google.genai as genai
from google.genai import types as genai_types

try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class LLMGenerator:
    """Genera respuestas usando Gemini (Vertex AI o API pública)."""

    LANGUAGE_INSTRUCTIONS = {
        'es': 'Responde en español de forma natural y profesional.',
        'en': 'Respond in English with a clear, professional tone.',
        'fr': 'Réponds en français avec un ton professionnel et naturel.',
        'pt': 'Responda em português com um tom profissional e natural.'
    }

    def __init__(self):
        self.project_id = os.environ.get('PROJECT_ID')
        self.region = os.environ.get('REGION', 'us-central1')
        # Use stable Gemini model
        self.model_name = os.environ.get(
            'MODEL_NAME',
            'models/gemini-2.5-flash'
        )
        self.genai_api_key = os.environ.get('GENAI_API_KEY')
        self.deepseek_api_key = os.environ.get('DEEPSEEK_API_KEY')

        # Determinar modo de operación — API pública tiene prioridad
        self.use_public_api = bool(self.genai_api_key)

        if not self.use_public_api and not self.project_id:
            raise ValueError("Se requiere GENAI_API_KEY (Gemini API) o PROJECT_ID (Vertex AI)")

        if self.use_public_api and not self.model_name.startswith("models/"):
            self.model_name = f"models/{self.model_name}"

        # Inicializar cliente DeepSeek si está disponible
        self.deepseek_client = None
        if self.deepseek_api_key and OPENAI_AVAILABLE:
            try:
                self.deepseek_client = OpenAI(
                    api_key=self.deepseek_api_key,
                    base_url="https://api.deepseek.com"
                )
                logger.info("DeepSeek API client initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize DeepSeek client: {e}")

        if self.use_public_api:
            # API pública de Gemini (solo API key, sin project/location)
            try:
                self.model = genai.Client(api_key=self.genai_api_key)
                logger.info(
                    "LLM initialized with Gemini public API model %s",
                    self.model_name
                )
            except Exception as e:
                logger.error(
                    "Failed to initialize Gemini public API client: %s", e
                )
                raise
        else:
            # Vertex AI nativo — import lazy para no cargar en memoria cuando no se usa
            import vertexai
            from vertexai.generative_models import GenerativeModel
            vertexai.init(project=self.project_id, location=self.region)

            try:
                self.model = GenerativeModel(self.model_name)
                logger.info(
                    "LLM initialized with Vertex AI model %s", self.model_name
                )
            except Exception as e:
                logger.error(
                    "Failed to initialize Vertex AI Gemini model %s: %s",
                    self.model_name,
                    e
                )
                raise

    def generate_answer(
        self,
        question: str,
        context_chunks: List[str],
        conversation_history: Optional[List[Dict[str, str]]] = None,
        system_prompt: Optional[str] = None,
        response_language: Optional[str] = None,
        model_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Genera una respuesta basada en la pregunta y contexto

        Args:
            question: Pregunta del usuario
            context_chunks: Chunks de documentos relevantes
            conversation_history: Historial de conversación (opcional)
            system_prompt: Instrucciones personalizadas para el asistente
            response_language: Código de idioma preferido para la respuesta
            model_name: Nombre del modelo a usar (opcional, usa el default si no se especifica)

        Returns:
            Dict con answer, confidence, y metadata
        """
        try:
            conversation_history = conversation_history or []
            # Construir prompt con contexto
            context_text = "\n\n".join([
                f"[Documento {i+1}]:\n{chunk}"
                for i, chunk in enumerate(context_chunks)
            ])

            # Incluir historial si existe
            history_text = ""
            if conversation_history:
                history_text = "\nHistorial de conversación:\n"
                for msg in conversation_history[-3:]:  # Últimos 3 mensajes
                    role = "Usuario" if msg['type'] == 'user' else "Asistente"
                    history_text += f"{role}: {msg['content']}\n"

            instructions_block = self._build_instructions(
                system_prompt=system_prompt,
                response_language=response_language,
            )

            prompt = f"""Eres un asistente experto que responde preguntas basándose únicamente en la información proporcionada.

{history_text}

Contexto de documentos:
{context_text}

Pregunta del usuario: {question}

Instrucciones:
{instructions_block}

Respuesta:"""

            # Usar modelo especificado o el default
            active_model = model_name if model_name else self.model_name

            # Generar respuesta
            logger.info(f"Generating response with model: {active_model}")

            start_time = time.perf_counter()
            answer, usage_metadata = self._generate_with_model(prompt, active_model)
            latency_ms = (time.perf_counter() - start_time) * 1000

            usage = self._normalize_usage(usage_metadata)

            # Calcular confidence basado en la cantidad de contexto disponible
            confidence = self._calculate_confidence(context_chunks, answer)

            logger.info(f"Response generated with confidence {confidence:.2f}")

            return {
                'answer': answer,
                'confidence': confidence,
                'model': active_model,
                'context_chunks_used': len(context_chunks),
                'latency_ms': latency_ms,
                'token_usage': usage
            }

        except Exception as e:
            logger.error(f"Error generating answer: {str(e)}", exc_info=True)
            raise

    def _calculate_confidence(self, context_chunks: List[str], answer: str) -> float:
        """
        Calcula un score de confianza basado en la respuesta

        Args:
            context_chunks: Chunks usados como contexto
            answer: Respuesta generada

        Returns:
            Score entre 0 y 1
        """
        # Heurística simple de confianza
        base_confidence = 0.5

        # Más contexto = más confianza
        if len(context_chunks) >= 3:
            base_confidence += 0.2
        elif len(context_chunks) >= 2:
            base_confidence += 0.1

        # Respuesta más larga (hasta cierto punto) = más confianza
        answer_length = len(answer.split())
        if 50 <= answer_length <= 300:
            base_confidence += 0.2
        elif answer_length > 20:
            base_confidence += 0.1

        # Si la respuesta indica incertidumbre, reducir confianza
        uncertainty_phrases = [
            'no tengo información',
            'no puedo encontrar',
            'no está en el contexto',
            'no disponible'
        ]
        if any(phrase in answer.lower() for phrase in uncertainty_phrases):
            base_confidence -= 0.3

        return max(0.1, min(1.0, base_confidence))

    def _normalize_model_name(self, model_name: str) -> str:
        """
        Normaliza el nombre del modelo según el modo de operación.
        - Para Vertex AI: remueve 'models/' prefix
        - Para API pública: asegura que tenga 'models/' prefix
        """
        if self.use_public_api:
            # API pública necesita el prefijo 'models/'
            if not model_name.startswith('models/'):
                return f'models/{model_name}'
            return model_name
        else:
            # Vertex AI no usa el prefijo 'models/'
            if model_name.startswith('models/'):
                return model_name.replace('models/', '', 1)
            return model_name

    def _generate_with_model(self, prompt: str, model_name: str) -> Tuple[str, Optional[Any]]:
        """Encapsula la llamada al modelo según el modo configurado."""
        generation_params = {
            "temperature": 0.3,
            "top_p": 0.8,
            "top_k": 40,
            "max_output_tokens": 1024,
        }

        # Detectar si es un modelo DeepSeek
        is_deepseek = model_name in ['deepseek-chat', 'deepseek-reasoner']

        if is_deepseek:
            return self._generate_with_deepseek(prompt, model_name, generation_params)

        # Normalizar el nombre del modelo
        normalized_model = self._normalize_model_name(model_name)

        # Para modelos Gemini, usar API pública o Vertex AI
        if self.use_public_api:
            response = self.model.models.generate_content(
                model=normalized_model,
                contents=prompt,
                config=generation_params
            )

            if not response.candidates:
                raise ValueError("Gemini public API returned no candidates")

            # Buscar el primer texto disponible
            for candidate in response.candidates:
                parts = getattr(candidate, "content", None)
                if not parts:
                    continue
                for part in parts.parts:
                    if part.text:
                        return part.text, getattr(response, "usage_metadata", None)

            raise ValueError("Gemini public API response without text content")

        # Vertex AI path - necesitamos crear una instancia del modelo si cambió
        normalized_default = self._normalize_model_name(self.model_name)
        if normalized_model != normalized_default:
            from vertexai.generative_models import GenerativeModel
            temp_model = GenerativeModel(normalized_model)
            response = temp_model.generate_content(
                prompt,
                generation_config=generation_params
            )
        else:
            response = self.model.generate_content(
                prompt,
                generation_config=generation_params
            )

        return response.text, getattr(response, "usage_metadata", None)

    def _generate_with_deepseek(
        self,
        prompt: str,
        model_name: str,
        generation_params: Dict[str, Any]
    ) -> Tuple[str, Optional[Any]]:
        """Genera respuesta usando DeepSeek API (compatible con OpenAI)."""
        if not self.deepseek_client:
            raise ValueError(
                "DeepSeek API not available. Please set DEEPSEEK_API_KEY environment variable "
                "and ensure openai package is installed."
            )

        try:
            # Mapear modelo name a DeepSeek API
            deepseek_model_map = {
                'deepseek-chat': 'deepseek-chat',
                'deepseek-reasoner': 'deepseek-reasoner'
            }

            api_model = deepseek_model_map.get(model_name, 'deepseek-chat')

            response = self.deepseek_client.chat.completions.create(
                model=api_model,
                messages=[
                    {"role": "user", "content": prompt}
                ],
                temperature=generation_params.get("temperature", 0.3),
                top_p=generation_params.get("top_p", 0.8),
                max_tokens=generation_params.get("max_output_tokens", 1024),
                stream=False
            )

            if not response.choices:
                raise ValueError("DeepSeek API returned no choices")

            answer = response.choices[0].message.content

            # Construir usage metadata compatible
            usage_metadata = {
                'prompt_tokens': response.usage.prompt_tokens if response.usage else None,
                'completion_token_count': response.usage.completion_tokens if response.usage else None,
                'total_tokens': response.usage.total_tokens if response.usage else None
            }

            return answer, usage_metadata

        except Exception as e:
            logger.error(f"Error calling DeepSeek API: {str(e)}")
            raise

    def _normalize_usage(self, usage: Optional[Any]) -> Dict[str, int]:
        """Convierte metadatos de uso en un diccionario simple."""
        if not usage:
            return {}

        if isinstance(usage, dict):
            prompt = usage.get('prompt_token_count') or usage.get('prompt_tokens')
            response = usage.get('candidates_token_count') or usage.get('completion_token_count') or usage.get('response_tokens')
            total = usage.get('total_token_count') or usage.get('total_tokens')
        else:
            prompt = getattr(usage, 'prompt_token_count', None) or getattr(usage, 'prompt_tokens', None)
            response = (
                getattr(usage, 'candidates_token_count', None)
                or getattr(usage, 'completion_token_count', None)
                or getattr(usage, 'response_tokens', None)
            )
            total = getattr(usage, 'total_token_count', None) or getattr(usage, 'total_tokens', None)

        def _to_int(value: Optional[Any]) -> Optional[int]:
            if value is None:
                return None
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        normalized = {
            'prompt_tokens': _to_int(prompt),
            'response_tokens': _to_int(response),
            'total_tokens': _to_int(total),
        }

        return {key: val for key, val in normalized.items() if val is not None}

    def generate_summary(self, text: str, max_length: int = 200) -> str:
        """
        Genera un resumen de un texto

        Args:
            text: Texto a resumir
            max_length: Longitud máxima en palabras

        Returns:
            Resumen del texto
        """
        try:
            prompt = f"""Resume el siguiente texto en máximo {max_length} palabras, manteniendo los puntos clave:

{text}

Resumen:"""

            response = self.model.generate_content(
                prompt,
                generation_config={
                    "temperature": 0.3,
                    "max_output_tokens": max_length * 2
                }
            )

            return response.text

        except Exception as e:
            logger.error(f"Error generating summary: {str(e)}")
            return text[:max_length * 5]  # Fallback: truncar texto

    def _build_instructions(
        self,
        system_prompt: Optional[str],
        response_language: Optional[str],
    ) -> str:
        """
        Construye el bloque de instrucciones combinando reglas base, idioma y prompt personalizado.
        """
        language_instruction = self._language_instruction(response_language)

        base_instructions = (
            "1. Responde la pregunta usando ÚNICAMENTE la información del contexto proporcionado\n"
            "2. Si la respuesta no está en el contexto, indica claramente que no tienes esa información\n"
            "3. Sé conciso pero completo\n"
            "4. Si hay múltiples documentos relevantes, sintetiza la información\n"
            f"5. {language_instruction}"
        )

        if system_prompt and system_prompt.strip():
            return f"{base_instructions}\n\nInstrucciones adicionales del usuario:\n{system_prompt.strip()}"

        return base_instructions

    def _language_instruction(self, language_code: Optional[str]) -> str:
        """
        Retorna la instrucción adecuada para el idioma solicitado.
        """
        if not language_code:
            return self.LANGUAGE_INSTRUCTIONS['es']

        normalized = language_code.lower()
        return self.LANGUAGE_INSTRUCTIONS.get(normalized, self.LANGUAGE_INSTRUCTIONS['es'])
