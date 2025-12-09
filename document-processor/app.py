
"""
Document Processor Service
Servicio para procesar documentos, generar embeddings e indexar en Vertex AI
"""
import os
import uuid
import tempfile
from datetime import datetime, timezone
from io import BytesIO
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
import logging

from utils import TextExtractor, EmbeddingGenerator, StorageManager, IndexManager, PineconeManager

# Configuración de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Inicializar Flask
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max

# Configurar CORS para permitir requests desde Vercel
CORS(app,
     origins="*",
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
     allow_headers=["Content-Type", "Authorization"],
     expose_headers=["Content-Type"],
     supports_credentials=False,
     max_age=3600,
     send_wildcard=True,
     always_send=True)

# Servicios - Lazy loading para cold start más rápido
_storage_manager = None
_embedding_generator = None
_index_manager = None
_pinecone_manager = None
_use_pinecone = bool(os.environ.get("PINECONE_API_KEY"))


def get_storage_manager():
    """Inicializa StorageManager solo cuando se necesita (lazy loading)"""
    global _storage_manager
    if _storage_manager is None:
        _storage_manager = StorageManager()
        logger.info("✅ StorageManager initialized")
    return _storage_manager


def get_embedding_generator():
    """Inicializa EmbeddingGenerator solo cuando se necesita (lazy loading)"""
    global _embedding_generator
    if _embedding_generator is None:
        _embedding_generator = EmbeddingGenerator()
        logger.info("✅ EmbeddingGenerator initialized")
    return _embedding_generator


def get_index_manager():
    """Inicializa IndexManager o PineconeManager solo cuando se necesita (lazy loading)"""
    global _index_manager, _pinecone_manager

    if _use_pinecone:
        if _pinecone_manager is None:
            _pinecone_manager = PineconeManager()
            logger.info("✅ PineconeManager initialized (ultra-fast indexing)")
        return _pinecone_manager
    else:
        if _index_manager is None:
            _index_manager = IndexManager()
            logger.info("✅ IndexManager initialized")
        return _index_manager


def services_ready() -> bool:
    """Verifica que los servicios requeridos estén disponibles (no necesariamente inicializados)"""
    return True  # Los servicios se inicializan on-demand


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    status = {
        'status': 'healthy',
        'service': 'document-processor',
        'version': '1.0.0'
    }

    if not services_ready():
        status['status'] = 'unhealthy'
        status['error'] = 'Services not properly initialized'
        return jsonify(status), 503

    return jsonify(status), 200


@app.route('/upload', methods=['POST'])
def upload_document():
    """Sube, procesa y registra un documento."""
    try:
        if not services_ready():
            return jsonify({
                'error': 'Service unavailable',
                'details': 'Required services are not initialized'
            }), 503

        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']

        if file.filename == '':
            return jsonify({'error': 'Empty filename'}), 400

        filename = secure_filename(file.filename)
        _, ext = os.path.splitext(filename.lower())

        if ext not in TextExtractor.SUPPORTED_FORMATS:
            return jsonify({
                'error': f'Unsupported format: {ext}',
                'supported_formats': list(TextExtractor.SUPPORTED_FORMATS)
            }), 400

        document_id = str(uuid.uuid4())
        logger.info(f"Processing document {document_id}: {filename}")

        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as temp_file:
            file.save(temp_file.name)
            temp_path = temp_file.name

        try:
            logger.info(f"Extracting text from {filename}")
            text, doc_type = TextExtractor.extract_text(temp_path, filename)

            if not text or len(text.strip()) < 10:
                return jsonify({'error': 'No text could be extracted from document'}), 400

            logger.info("Chunking text")
            chunks = TextExtractor.chunk_text(text, chunk_size=500, overlap=50)

            if not chunks:
                return jsonify({'error': 'Failed to create text chunks'}), 500

            logger.info(f"Generating embeddings for {len(chunks)} chunks")
            embedding_gen = get_embedding_generator()
            embeddings = embedding_gen.generate_embeddings(chunks)

            logger.info("Uploading original document to GCS")
            storage = get_storage_manager()
            doc_uri = storage.upload_document(temp_path, document_id, filename)

            logger.info("Uploading processed chunks to GCS")
            chunks_uri = storage.upload_text_chunks(document_id, chunks)

            logger.info("Uploading embeddings metadata")
            embeddings_uri = storage.upload_embeddings_metadata(
                document_id,
                embeddings,
                chunks
            )

            file_size = os.path.getsize(temp_path)
            uploaded_at = datetime.now(timezone.utc).isoformat()

            # Indexación: Pinecone (rápido) o Matching Engine (lento)
            indexed = False
            index_error = None
            indexing_status = "indexing"

            if _use_pinecone:
                # PINECONE: Indexación ultra-rápida (milisegundos)
                logger.info(
                    "🚀 Upserting to Pinecone (fast indexing, size=%d bytes)",
                    file_size
                )
                try:
                    index_mgr = get_index_manager()  # Returns pinecone_manager
                    result = index_mgr.upsert_embeddings(
                        document_id=document_id,
                        chunks=chunks,
                        embeddings=embeddings
                    )
                    indexed = True
                    indexing_status = "ready"
                    logger.info("✅ Document indexed in Pinecone successfully in milliseconds!")
                except Exception as exc:
                    logger.error(f"❌ Failed to index in Pinecone: {exc}")
                    index_error = str(exc)
                    indexing_status = "index_failed"

            else:
                # MATCHING ENGINE: Indexación lenta con async
                logger.info(
                    "Updating Matching Engine index with new embeddings (async=True, size=%d bytes)",
                    file_size
                )
                use_async = True

                # Para archivos grandes: usar modo asíncrono con callback
                def on_indexing_complete(success: bool, error_msg: str = None):
                    """Callback que se ejecuta cuando termina la indexación asíncrona"""
                    try:
                        # IMPORTANTE: Crear nueva instancia de StorageManager para el thread
                        # No podemos usar la instancia compartida porque puede estar en otro contexto
                        from utils import StorageManager
                        thread_storage = StorageManager()

                        # Recuperar y actualizar metadatos
                        current_metadata = thread_storage.get_document_metadata(document_id)
                        if current_metadata:
                            current_metadata['indexed'] = success
                            current_metadata['status'] = 'ready' if success else 'index_failed'
                            if error_msg:
                                current_metadata['index_error'] = error_msg
                            elif 'index_error' in current_metadata:
                                del current_metadata['index_error']

                            thread_storage.save_document_metadata(document_id, current_metadata)
                            logger.info(
                                "✅ Document %s indexing completed: success=%s",
                                document_id,
                                success
                            )
                        else:
                            logger.error(
                                "❌ Could not update metadata for document %s after indexing",
                                document_id
                            )
                    except Exception as callback_error:
                        logger.error(
                            "❌ Error updating document %s metadata after indexing: %s",
                            document_id,
                            str(callback_error),
                            exc_info=True
                        )

                try:
                    index_mgr = get_index_manager()  # Returns index_manager
                    index_mgr.import_embeddings(
                        embeddings_uri,
                        async_mode=True,
                        on_complete=on_indexing_complete
                    )
                    indexed = False  # Still indexing in background
                    indexing_status = "indexing"
                    logger.info("Document indexing started in background")
                except Exception as exc:
                    logger.warning("Failed to start background indexing: %s", exc)
                    index_error = str(exc)
                    indexing_status = "index_failed"

            metadata = {
                'document_id': document_id,
                'filename': filename,
                'document_type': doc_type,
                'mime_type': file.mimetype,
                'size': file_size,
                'uploaded_at': uploaded_at,
                'status': indexing_status,
                'indexed': indexed,
                'total_chunks': len(chunks),
                'total_characters': len(text),
                'uris': {
                    'document': doc_uri,
                    'chunks': chunks_uri,
                    'embeddings': embeddings_uri
                }
            }

            if index_error:
                metadata['index_error'] = index_error

            metadata_uri = storage.save_document_metadata(document_id, metadata)
            metadata['uris']['metadata'] = metadata_uri

            # Build response message based on status
            if indexing_status == "indexing":
                message = "Document processed. Indexing in progress in background. Use polling to check status."
            elif indexing_status == "index_failed":
                message = "Document processed but indexing failed to start"
            else:
                message = "Document processing completed"

            response = {
                'status': indexing_status,
                'document_id': document_id,
                'filename': filename,
                'document_type': doc_type,
                'mime_type': file.mimetype,
                'size': file_size,
                'uploaded_at': uploaded_at,
                'indexed': indexed,
                'total_chunks': len(chunks),
                'total_characters': len(text),
                'message': message,
                'uris': metadata['uris']
            }

            if index_error:
                response['index_error'] = index_error

            logger.info(f"Document {document_id} processed successfully (indexed={indexed})")
            return jsonify(response), 200

        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        return jsonify({'error': str(e)}), 400

    except RuntimeError as e:
        logger.error(f"Embedding service error: {str(e)}")
        return jsonify({'error': 'Embedding service unavailable', 'details': str(e)}), 503

    except Exception as e:
        logger.error(f"Error processing document: {str(e)}", exc_info=True)
        return jsonify({
            'error': 'Internal server error processing document',
            'details': str(e)
        }), 500


@app.route('/documents', methods=['GET'])
def list_documents():
    if not services_ready():
        return jsonify({'error': 'Service unavailable'}), 503
    try:
        storage = get_storage_manager()
        documents = storage.list_documents()
        return jsonify({'documents': documents}), 200
    except Exception as e:
        logger.error(f"Error listing documents: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to list documents', 'details': str(e)}), 500


@app.route('/documents/<document_id>', methods=['GET'])
def get_document_info(document_id):
    if not services_ready():
        return jsonify({'error': 'Service unavailable'}), 503
    try:
        storage = get_storage_manager()
        metadata = storage.get_document_metadata(document_id)
        if not metadata:
            return jsonify({'error': 'Document not found'}), 404

        chunks = storage.get_document_chunks(document_id)
        metadata['chunks'] = chunks
        metadata['total_chunks'] = len(chunks)
        return jsonify(metadata), 200
    except Exception as e:
        logger.error(f"Error retrieving document info: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to retrieve document info', 'details': str(e)}), 500


@app.route('/documents/<document_id>/status', methods=['GET'])
def get_document_status(document_id):
    """Consulta el estado de indexación de un documento específico."""
    if not services_ready():
        return jsonify({'error': 'Service unavailable'}), 503

    try:
        storage = get_storage_manager()
        metadata = storage.get_document_metadata(document_id)
        if not metadata:
            return jsonify({'error': 'Document not found'}), 404

        # Return minimal status information for polling
        status_info = {
            'document_id': document_id,
            'status': metadata.get('status', 'unknown'),
            'indexed': metadata.get('indexed', False),
            'filename': metadata.get('filename', ''),
        }

        # Include error if present
        if 'index_error' in metadata:
            status_info['index_error'] = metadata['index_error']

        return jsonify(status_info), 200

    except Exception as e:
        logger.error(f"Error checking document status: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to check document status', 'details': str(e)}), 500


@app.route('/documents/<document_id>', methods=['DELETE'])
def delete_document(document_id):
    if not services_ready():
        return jsonify({'error': 'Service unavailable'}), 503
    try:
        storage = get_storage_manager()
        deleted = storage.delete_document(document_id)
        if not deleted:
            return jsonify({'error': 'Document not found'}), 404
        return jsonify({'status': 'deleted', 'document_id': document_id}), 200
    except Exception as e:
        logger.error(f"Error deleting document: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to delete document', 'details': str(e)}), 500


@app.route('/documents/<document_id>/download', methods=['GET'])
def download_document(document_id):
    if not services_ready():
        return jsonify({'error': 'Service unavailable'}), 503
    try:
        storage = get_storage_manager()
        content, filename, mime_type = storage.download_document_content(document_id)
        return send_file(
            BytesIO(content),
            mimetype=mime_type or 'application/octet-stream',
            as_attachment=True,
            download_name=filename,
        )
    except FileNotFoundError:
        return jsonify({'error': 'Document not found'}), 404
    except Exception as e:
        logger.error(f"Error generating download: {str(e)}", exc_info=True)
        return jsonify({'error': 'Failed to download document', 'details': str(e)}), 500


@app.route('/documents/<document_id>/reindex', methods=['POST'])
def reindex_document(document_id):
    """Reindexa un documento que falló en la indexación inicial"""
    if not services_ready():
        return jsonify({'error': 'Service unavailable'}), 503

    try:
        logger.info(f"Reindexing document {document_id}")

        # Obtener metadata del documento
        storage = get_storage_manager()
        metadata = storage.get_document_metadata(document_id)
        if not metadata:
            return jsonify({'error': 'Document not found'}), 404

        # Verificar que tenga embeddings URI
        embeddings_uri = metadata.get('uris', {}).get('embeddings')
        if not embeddings_uri:
            return jsonify({'error': 'Document embeddings not found'}), 404

        # Intentar indexar
        try:
            index_mgr = get_index_manager()
            index_mgr.import_embeddings(embeddings_uri, async_mode=False)
            logger.info(f"Document {document_id} reindexed successfully")

            # Actualizar metadata
            metadata['status'] = 'ready'
            metadata['indexed'] = True
            if 'index_error' in metadata:
                del metadata['index_error']

            storage.save_document_metadata(document_id, metadata)

            return jsonify({
                'status': 'success',
                'message': 'Document reindexed successfully',
                'document_id': document_id
            }), 200

        except Exception as exc:
            logger.error(f"Failed to reindex document {document_id}: {str(exc)}")
            return jsonify({
                'error': 'Failed to reindex document',
                'details': str(exc)
            }), 500

    except Exception as e:
        logger.error(f"Error reindexing document: {str(e)}", exc_info=True)
        return jsonify({'error': 'Internal server error', 'details': str(e)}), 500


@app.route('/documents/sync', methods=['POST'])
def sync_documents():
    """
    Sincroniza el estado de documentos estancados en 'indexing' o con problemas.
    Este endpoint detecta y repara documentos que:
    - Están en estado 'indexing' por más de 5 minutos
    - Tienen chunks faltantes en GCS
    - Necesitan reintento de indexación
    """
    if not services_ready():
        return jsonify({'error': 'Service unavailable'}), 503

    try:
        from datetime import datetime, timedelta

        logger.info("Starting document synchronization")

        # Obtener todos los documentos
        storage = get_storage_manager()
        index_mgr = get_index_manager()
        documents = storage.list_documents()

        # Tiempo límite: documentos en 'indexing' por más de 5 minutos
        STALE_THRESHOLD_MINUTES = 5
        stale_cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALE_THRESHOLD_MINUTES)

        sync_results = {
            'total_documents': len(documents),
            'stale_detected': 0,
            'chunks_missing': 0,
            'reindex_attempted': 0,
            'reindex_succeeded': 0,
            'reindex_failed': 0,
            'marked_as_failed': 0,
            'details': []
        }

        for doc in documents:
            document_id = doc.get('document_id')
            status = doc.get('status')
            uploaded_at_str = doc.get('uploaded_at')

            if not document_id or not status:
                continue

            # Detectar documentos estancados en 'indexing'
            if status == 'indexing':
                try:
                    uploaded_at = datetime.fromisoformat(uploaded_at_str.replace('Z', '+00:00'))
                    time_since_upload = datetime.now(timezone.utc) - uploaded_at

                    if time_since_upload > timedelta(minutes=STALE_THRESHOLD_MINUTES):
                        sync_results['stale_detected'] += 1
                        logger.warning(f"Document {document_id} stale in 'indexing' state for {time_since_upload}")

                        # Verificar si los chunks existen en GCS
                        chunks = storage.get_document_chunks(document_id)

                        if not chunks:
                            sync_results['chunks_missing'] += 1
                            logger.error(f"Document {document_id} has no chunks in GCS, marking as failed")

                            # Marcar como fallido si no hay chunks
                            doc['status'] = 'index_failed'
                            doc['indexed'] = False
                            doc['index_error'] = 'Chunks not found in storage after indexing timeout'
                            storage.save_document_metadata(document_id, doc)
                            sync_results['marked_as_failed'] += 1

                            sync_results['details'].append({
                                'document_id': document_id,
                                'filename': doc.get('filename', 'unknown'),
                                'action': 'marked_as_failed',
                                'reason': 'chunks_missing'
                            })
                        else:
                            # Chunks existen, intentar reindexar
                            embeddings_uri = doc.get('uris', {}).get('embeddings')

                            if embeddings_uri:
                                sync_results['reindex_attempted'] += 1
                                logger.info(f"Attempting to reindex document {document_id}")

                                try:
                                    index_mgr.import_embeddings(embeddings_uri, async_mode=False)

                                    # Actualizar metadata como exitoso
                                    doc['status'] = 'ready'
                                    doc['indexed'] = True
                                    if 'index_error' in doc:
                                        del doc['index_error']
                                    storage.save_document_metadata(document_id, doc)

                                    sync_results['reindex_succeeded'] += 1
                                    logger.info(f"Document {document_id} successfully reindexed")

                                    sync_results['details'].append({
                                        'document_id': document_id,
                                        'filename': doc.get('filename', 'unknown'),
                                        'action': 'reindexed',
                                        'status': 'success'
                                    })

                                except Exception as reindex_error:
                                    sync_results['reindex_failed'] += 1
                                    logger.error(f"Failed to reindex document {document_id}: {str(reindex_error)}")

                                    # Marcar como fallido
                                    doc['status'] = 'index_failed'
                                    doc['indexed'] = False
                                    doc['index_error'] = f"Reindex attempt failed: {str(reindex_error)}"
                                    storage.save_document_metadata(document_id, doc)
                                    sync_results['marked_as_failed'] += 1

                                    sync_results['details'].append({
                                        'document_id': document_id,
                                        'filename': doc.get('filename', 'unknown'),
                                        'action': 'reindex_failed',
                                        'error': str(reindex_error)
                                    })
                            else:
                                # No hay embeddings URI, marcar como fallido
                                logger.error(f"Document {document_id} has no embeddings URI")
                                doc['status'] = 'index_failed'
                                doc['indexed'] = False
                                doc['index_error'] = 'Embeddings URI not found'
                                storage.save_document_metadata(document_id, doc)
                                sync_results['marked_as_failed'] += 1

                                sync_results['details'].append({
                                    'document_id': document_id,
                                    'filename': doc.get('filename', 'unknown'),
                                    'action': 'marked_as_failed',
                                    'reason': 'embeddings_uri_missing'
                                })

                except Exception as e:
                    logger.error(f"Error processing document {document_id}: {str(e)}")
                    continue

        logger.info(f"Synchronization completed: {sync_results}")

        return jsonify({
            'status': 'completed',
            'summary': sync_results
        }), 200

    except Exception as e:
        logger.error(f"Error during document synchronization: {str(e)}", exc_info=True)
        return jsonify({'error': 'Synchronization failed', 'details': str(e)}), 500


@app.errorhandler(413)
def request_entity_too_large(error):
    """Manejar archivos demasiado grandes"""
    return jsonify({
        'error': 'File too large',
        'max_size': '50MB'
    }), 413


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
