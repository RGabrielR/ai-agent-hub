# Fábrica de Agentes AI

Una plataforma de agentes de IA con capacidades RAG (Retrieval-Augmented Generation) para análisis inteligente de documentos.

## Características

### Agentes Disponibles

#### ChatRag — Sistema RAG Conversacional
- Carga y procesamiento de documentos (PDF, DOCX, TXT)
- Indexación vectorial
- Chat inteligente con contexto de documentos
- Búsqueda semántica avanzada
- Soporte multi-idioma (ES, EN, FR, PT)

## Arquitectura

```
Frontend (Vercel)          Backend (GCP Cloud Run)
┌─────────────────┐       ┌──────────────────────┐
│                 │       │                      │
│  React + Vite   │◄─────►│  Document Processor  │
│  TypeScript     │       │  (Python/Flask)      │
│  Tailwind CSS   │       │                      │
│                 │       ├──────────────────────┤
│                 │       │                      │
│                 │◄─────►│  RAG Backend         │
│                 │       │  (Python/Flask)      │
│                 │       │                      │
└─────────────────┘       └──────────┬───────────┘
                                     │
                          ┌──────────┴───────────┐
                          │  Cloud Storage +     │
                          │  Pinecone / BigQuery  │
                          └──────────────────────┘
```

## Inicio Rápido

### Prerrequisitos

- Node.js 18+
- Python 3.11+
- Google Cloud SDK (gcloud CLI)
- Proyecto en Google Cloud Platform
- Gemini API Key (Google AI Studio — gratis)

### Instalación Local

```bash
# 1. Clonar el repositorio
git clone https://github.com/RGabrielR/agent-ai-weekly.git
cd agent-ai-weekly

# 2. Instalar dependencias del frontend
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus configuraciones

# 4. Iniciar frontend
npm run dev
```

Abre [http://localhost:5173](http://localhost:5173) en tu navegador.

## Despliegue en Producción

```bash
# 1. Configurar gcloud con tu proyecto personal
gcloud config set project YOUR_PROJECT_ID

# 2. Desplegar backends en Cloud Run
chmod +x scripts/deploy-all-gcp.sh
./scripts/deploy-all-gcp.sh

# 3. Configurar variables de entorno para producción
cp .env.production.example .env.production
# Actualiza las URLs con las proporcionadas por el script

# 4. Desplegar frontend en Vercel
npm i -g vercel
vercel --prod
```

## Estructura del Proyecto

```
agente-weekly-ai/
├── src/
│   ├── agents/
│   │   └── chatrag/             # Agente ChatRag (RAG conversacional)
│   ├── components/              # Componentes React
│   ├── lib/                     # Servicios y utilidades
│   └── pages/                   # Páginas de la aplicación
├── document-processor/          # Backend procesamiento de docs
├── rag-backend/                 # Backend RAG
├── scripts/                     # Scripts de despliegue
└── README.md
```

## Tecnologías Utilizadas

### Frontend
- React 18 + TypeScript
- Vite
- Tailwind CSS
- Lucide Icons

### Backend
- Flask (Python)
- Google Gemini API
- Pinecone (vector DB)
- Google Cloud Services (Storage, BigQuery)

### Infraestructura
- Google Cloud Run (Backends)
- Vercel (Frontend)
- Google Cloud Storage (Documentos)

## Variables de Entorno

### Desarrollo (.env)
```env
VITE_DOCUMENT_PROCESSOR_URL=http://localhost:8080
VITE_RAG_BACKEND_URL=http://localhost:8080
VITE_PROJECT_ID=your-gcp-project-id
VITE_BUCKET_NAME=your-project-rag-documents
```

### Producción (.env.production)
```env
VITE_DOCUMENT_PROCESSOR_URL=https://rag-document-processor-xxx.run.app
VITE_RAG_BACKEND_URL=https://rag-agent-backend-xxx.run.app
VITE_PROJECT_ID=your-gcp-project-id
VITE_BUCKET_NAME=your-project-rag-documents
```

## Uso

1. **Cargar Documentos** — Ve a la sección "Documentos", arrastra o selecciona archivos PDF, DOCX o TXT
2. **Chatear con Documentos** — Haz preguntas sobre el contenido; el sistema usará RAG para respuestas contextuales
3. **Base de Conocimiento** — Visualiza analytics y estadísticas de los documentos indexados

## API Endpoints

### Document Processor
- `POST /upload` - Cargar documento
- `GET /documents` - Listar documentos
- `GET /health` - Health check

### RAG Backend
- `POST /query` - Chat con contexto RAG
- `GET /conversations` - Historial de conversaciones
- `GET /analytics/knowledge-base` - Analytics
- `GET /health` - Health check

## Costos Estimados (cuenta personal)

Con Cloud Run (min-instances=0) + Gemini API free tier:
- **Cloud Run**: Gratis (2M req/mes free tier)
- **Cloud Storage**: Gratis (5GB/mes)
- **Gemini API**: Gratis (rate limits)
- **Pinecone**: Gratis (1 índice, 100K vectores)
- **Vercel**: Gratis (plan hobby)
- **Total estimado**: ~$0/mes para uso personal

## Troubleshooting

### Backend no responde
```bash
gcloud run services list --region us-central1
gcloud run services logs tail rag-agent-backend --region us-central1
```

### Error CORS
Verifica que en los backends (`main.py`) estén configurados los orígenes correctos:
```python
allow_origins=["https://tu-app.vercel.app", "http://localhost:5173"]
```

## Roadmap

- [ ] Autenticación de usuarios
- [ ] Tests automatizados
- [ ] CI/CD con GitHub Actions
- [ ] Dashboard de analytics avanzado
- [ ] Más agentes especializados

## Licencia

MIT

---

**Versión**: 1.0.0
