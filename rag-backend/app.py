"""
RAG Backend Service
Servicio para consultas RAG, búsqueda vectorial y generación de respuestas
"""
import os
import uuid
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import logging

from utils import VectorSearch, PineconeSearch, LLMGenerator, ConversationManager, StorageRetriever

# Configuración de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Inicializar Flask
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10MB max

# CORS — solo orígenes permitidos (configurar ALLOWED_ORIGINS en producción)
_allowed_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")]
CORS(app,
     origins=_allowed_origins,
     methods=["GET", "POST", "DELETE", "OPTIONS"],
     allow_headers=["Content-Type", "X-API-Key"],
     max_age=3600)

# Rate limiting — protección contra abuso
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["100 per hour", "30 per minute"],
    storage_uri="memory://",
)

# API Key — autenticación simple compartida con el frontend
_BACKEND_API_KEY = os.environ.get("BACKEND_API_KEY", "")


@app.before_request
def check_api_key():
    """Valida X-API-Key en todos los endpoints excepto /health y OPTIONS."""
    if request.method == "OPTIONS" or request.path == "/health":
        return
    if _BACKEND_API_KEY:
        provided = request.headers.get("X-API-Key", "")
        if provided != _BACKEND_API_KEY:
            return jsonify({"error": "Unauthorized"}), 401

# Inicializar servicios
try:
    # Usar Pinecone si está configurado, sino Matching Engine
    use_pinecone = bool(os.environ.get("PINECONE_API_KEY"))

    if use_pinecone:
        vector_search = PineconeSearch()
        logger.info("✅ RAG Backend initialized with PINECONE (ultra-fast search)")
    else:
        vector_search = VectorSearch()
        logger.info("RAG Backend initialized with Matching Engine")

    llm_generator = LLMGenerator()
    conversation_manager = ConversationManager()
    storage_retriever = StorageRetriever()
    logger.info("All services initialized successfully")
except Exception as e:
    logger.error(f"Failed to initialize services: {str(e)}")
    vector_search = None
    llm_generator = None
    conversation_manager = None
    storage_retriever = None


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    status = {
        'status': 'healthy',
        'service': 'rag-backend',
        'version': '1.0.0'
    }

    # Verificar que los servicios estén inicializados
    if not all([vector_search, llm_generator, conversation_manager, storage_retriever]):
        status['status'] = 'unhealthy'
        status['error'] = 'Services not properly initialized'
        return jsonify(status), 503

    return jsonify(status), 200


@app.route('/query', methods=['POST'])
@limiter.limit("20 per minute")
def query_rag():
    """
    Endpoint principal para consultas RAG

    Proceso:
    1. Recibir pregunta
    2. Buscar documentos similares (vector search)
    3. Recuperar chunks relevantes
    4. Generar respuesta con LLM
    5. Guardar en BigQuery
    6. Retornar respuesta
    """
    try:
        data = request.get_json()

        if not data or 'question' not in data:
            return jsonify({'error': 'Missing required field: question'}), 400

        question = data['question'].strip()

        if not question:
            return jsonify({'error': 'Question cannot be empty'}), 400

        # Obtener o crear conversation_id
        conversation_id = data.get('conversation_id')
        if not conversation_id:
            conversation_id = str(uuid.uuid4())
            logger.info(f"Created new conversation: {conversation_id}")
        else:
            logger.info(f"Continuing conversation: {conversation_id}")

        # Parámetros opcionales
        top_k = data.get('top_k', 5)
        include_history = data.get('include_history', True)

        response_language = data.get('response_language')
        system_prompt = data.get('system_prompt')
        model_name = data.get('model')

        logger.info(f"Processing query: {question[:50]}...")

        # 1. Buscar documentos similares
        logger.info("Searching for similar documents")
        search_results = vector_search.search_similar_documents(question, top_k=top_k)

        if not search_results:
            return jsonify({
                'answer': 'No encontré documentos relevantes para responder tu pregunta. Por favor, sube documentos primero o reformula tu pregunta.',
                'sources': [],
                'conversation_id': conversation_id,
                'confidence': 0.0
            }), 200

        # 2. Recuperar chunks de los documentos encontrados
        chunk_ids = [result['id'] for result in search_results]

        # Si usamos Pinecone, los chunks vienen en los resultados (mucho más rápido)
        if use_pinecone:
            logger.info(f"Using Pinecone results with embedded text ({len(search_results)} chunks)")
            chunks = [result.get('text', '') for result in search_results if result.get('text')]
        else:
            # Matching Engine: necesitamos recuperar chunks desde GCS
            logger.info(f"Retrieving chunks from {len(search_results)} search results from GCS")
            chunks = storage_retriever.get_chunks_by_ids(chunk_ids)

            # Log ratio of retrieved chunks
            retrieved_ratio = len(chunks) / len(chunk_ids) if chunk_ids else 0
            logger.info(f"Retrieved {len(chunks)}/{len(chunk_ids)} chunks ({retrieved_ratio:.1%})")

        if not chunks:
            logger.warning("No chunks retrieved")
            return jsonify({
                'answer': 'Encontré documentos relevantes en el índice, pero no pude recuperar su contenido. Es posible que los documentos estén siendo procesados o haya un problema de sincronización. Por favor, intenta de nuevo en unos momentos o contacta al administrador si el problema persiste.',
                'sources': [],
                'conversation_id': conversation_id,
                'confidence': 0.0
            }), 200

        # 3. Obtener historial de conversación si se solicita
        conversation_history = []
        if include_history:
            conversation_history = conversation_manager.get_conversation_history(
                conversation_id,
                limit=10
            )

        # 4. Generar respuesta con LLM (o devolver chunks si LLM falla)
        logger.info("Generating answer with LLM")

        # Intentar generar respuesta con LLM
        try:
            llm_response = llm_generator.generate_answer(
                question=question,
                context_chunks=chunks,
                conversation_history=conversation_history,
                system_prompt=system_prompt,
                response_language=response_language,
                model_name=model_name
            )

            answer = llm_response['answer']
            confidence = llm_response['confidence']
            latency_ms = llm_response.get('latency_ms')
            token_usage = llm_response.get('token_usage', {})

        except Exception as llm_error:
            # Si falla el LLM, devolver chunks directamente formateados
            logger.warning(f"LLM generation failed: {str(llm_error)}, returning chunks directly")

            # Formatear chunks como respuesta directa
            answer = "📄 **Información relevante encontrada en los documentos:**\n\n"
            for i, chunk in enumerate(chunks[:3], 1):  # Solo top 3 chunks
                answer += f"**Fragmento {i}:**\n{chunk}\n\n"

            answer += "\n⚠️ *Nota: Esta es una búsqueda directa. El sistema LLM no está disponible actualmente.*"

            confidence = 0.7  # Confianza media para búsqueda directa
            latency_ms = None
            token_usage = {}

            llm_response = {
                'answer': answer,
                'confidence': confidence,
                'model': 'direct-search (no LLM)',
                'latency_ms': latency_ms,
                'token_usage': token_usage
            }

        # 5. Extraer document_ids de los chunks
        source_documents = []
        seen_documents = set()
        for chunk_id in chunk_ids:
            if '_chunk_' not in chunk_id:
                continue
            document_id = chunk_id.split('_chunk_')[0]
            if document_id in seen_documents:
                continue
            seen_documents.add(document_id)
            document_name = storage_retriever.get_document_label(document_id)
            source_documents.append({
                'id': document_id,
                'name': document_name
            })

        metadata_payload = {
            'model': llm_response.get('model'),
            'chunks_used': len(chunks),
            'top_k': top_k,
        }

        if latency_ms is not None:
            metadata_payload['latency_ms'] = latency_ms

        if token_usage:
            metadata_payload['token_usage'] = token_usage

        # 6. Guardar en BigQuery
        logger.info("Saving conversation to BigQuery")
        conversation_manager.save_conversation_turn(
            conversation_id=conversation_id,
            user_question=question,
            assistant_answer=answer,
            sources=source_documents,
            confidence=confidence,
            metadata=metadata_payload
        )

        # 7. Preparar respuesta
        response = {
            'answer': answer,
            'sources': [doc['name'] or doc['id'] for doc in source_documents],
            'conversation_id': conversation_id,
            'confidence': confidence,
            'metadata': {
                'chunks_retrieved': len(chunks),
                'model_used': llm_response.get('model'),
                'latency_ms': latency_ms,
                'token_usage': token_usage,
                'source_documents': source_documents
            }
        }

        logger.info(f"Query processed successfully with confidence {confidence:.2f}")
        return jsonify(response), 200

    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        return jsonify({'error': str(e)}), 400

    except Exception as e:
        logger.error(f"Error processing query: {str(e)}", exc_info=True)
        return jsonify({
            'error': 'Internal server error processing query',
            'details': str(e)
        }), 500


@app.route('/conversations/<conversation_id>', methods=['GET'])
def get_conversation(conversation_id):
    """
    Recupera el historial completo de una conversación
    """
    try:
        messages = conversation_manager.get_conversation_history(conversation_id)

        if not messages:
            return jsonify({
                'error': 'Conversation not found or empty'
            }), 404

        return jsonify({
            'conversation_id': conversation_id,
            'messages': messages,
            'total_messages': len(messages)
        }), 200

    except Exception as e:
        logger.error(f"Error retrieving conversation: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/conversations', methods=['GET'])
def list_conversations():
    """
    Lista las conversaciones recientes
    """
    try:
        limit = request.args.get('limit', default=10, type=int)

        if limit < 1 or limit > 100:
            return jsonify({'error': 'Limit must be between 1 and 100'}), 400

        conversations = conversation_manager.list_recent_conversations(limit=limit)

        return jsonify({
            'conversations': conversations,
            'total': len(conversations)
        }), 200

    except Exception as e:
        logger.error(f"Error listing conversations: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/conversations/<conversation_id>', methods=['DELETE'])
def delete_conversation(conversation_id):
    """
    Elimina una conversación
    """
    try:
        success = conversation_manager.delete_conversation(conversation_id)

        if success:
            return jsonify({
                'message': 'Conversation deleted successfully',
                'conversation_id': conversation_id
            }), 200
        else:
            return jsonify({
                'error': 'Failed to delete conversation'
            }), 500

    except Exception as e:
        logger.error(f"Error deleting conversation: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/analytics/knowledge-base', methods=['GET'])
@app.route('/analytics/knowledge_base', methods=['GET'])
@limiter.limit("10 per minute")
def knowledge_base_analytics():
    """
    Retorna métricas agregadas para la base de conocimiento.
    """
    if not conversation_manager:
        return jsonify({'error': 'Analytics service unavailable'}), 503

    try:
        # Aceptar tanto snake_case como camelCase para máxima compatibilidad
        days = request.args.get('days', default=None, type=int)
        if days is None:
            days = request.args.get('Days', default=30, type=int)

        document_limit = request.args.get('document_limit', default=None, type=int)
        if document_limit is None:
            document_limit = request.args.get('documentLimit', default=50, type=int)

        if days is None:
            days = 30
        if document_limit is None or document_limit < 1:
            document_limit = 50

        analytics = conversation_manager.get_usage_summary(days=days, document_limit=document_limit)
        return jsonify(analytics), 200

    except Exception as e:
        logger.error(f"Error retrieving analytics: {str(e)}", exc_info=True)
        return jsonify({
            'summary': {
                'total_queries': 0,
                'avg_latency_ms': 0,
                'avg_total_tokens': 0,
                'avg_prompt_tokens': 0,
                'avg_response_tokens': 0,
                'total_tokens': 0
            },
            'documents': []
        }), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
