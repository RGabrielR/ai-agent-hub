"""
Pinecone vector search for ultra-fast RAG queries.
"""
import logging
import os
from typing import List, Dict, Any
from pinecone import Pinecone
import google.genai as genai

logger = logging.getLogger(__name__)


class PineconeSearch:
    """Fast vector search using Pinecone."""

    def __init__(self) -> None:
        self.api_key = os.environ.get("PINECONE_API_KEY")
        self.index_name = os.environ.get("PINECONE_INDEX_NAME", "rag-documents")
        self.project_id = os.environ.get("PROJECT_ID")
        self.region = os.environ.get("REGION", "us-central1")

        if not self.api_key:
            raise ValueError("PINECONE_API_KEY environment variable is required")

        # Initialize Pinecone client
        self.pc = Pinecone(api_key=self.api_key)

        # Get index
        try:
            self.index = self.pc.Index(self.index_name)
            logger.info(f"Connected to Pinecone index: {self.index_name}")
        except Exception as e:
            logger.error(f"Failed to connect to Pinecone index {self.index_name}: {e}")
            raise

        # Embedding via Gemini API (mismo modelo text-embedding-004, sin Vertex AI)
        genai_api_key = os.environ.get("GENAI_API_KEY")
        if not genai_api_key:
            raise ValueError("GENAI_API_KEY environment variable is required for embeddings")
        self.genai_client = genai.Client(api_key=genai_api_key)
        self.embedding_model_name = os.environ.get("EMBEDDING_MODEL_NAME", "text-embedding-004")
        logger.info(f"Embedding model: {self.embedding_model_name} via Gemini API")

    def search_similar_documents(
        self,
        query: str,
        top_k: int = 5,
        filter_dict: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        """
        Search for similar documents using vector similarity.

        Args:
            query: Natural language question from the user
            top_k: Number of results to return
            filter_dict: Optional metadata filter

        Returns:
            List of matching results with id, score, and metadata
        """
        try:
            logger.info(f"🚀 Generating embedding for query: {query[:50]}...")
            embed_response = self.genai_client.models.embed_content(
                model=self.embedding_model_name,
                contents=[query]
            )
            query_embedding = embed_response.embeddings[0].values

            logger.info(f"🔍 Searching Pinecone for top {top_k} results")

            # Query Pinecone (ULTRA FAST - typically <50ms)
            results = self.index.query(
                vector=query_embedding,
                top_k=top_k,
                include_metadata=True,
                filter=filter_dict
            )

            # Format results
            formatted_results = []
            for match in results.get('matches', []):
                formatted_results.append({
                    'id': match['id'],
                    'score': match['score'],
                    'document_id': match.get('metadata', {}).get('document_id', ''),
                    'chunk_index': match.get('metadata', {}).get('chunk_index', 0),
                    'text': match.get('metadata', {}).get('text', '')
                })

            logger.info(f"✅ Found {len(formatted_results)} results from Pinecone")
            return formatted_results

        except Exception as e:
            logger.error(f"❌ Error searching Pinecone: {str(e)}", exc_info=True)
            return []

    def get_index_stats(self) -> Dict[str, Any]:
        """Get Pinecone index statistics."""
        try:
            stats = self.index.describe_index_stats()
            return {
                "total_vectors": stats.get('total_vector_count', 0),
                "dimension": stats.get('dimension', 0),
                "index_fullness": stats.get('index_fullness', 0)
            }
        except Exception as e:
            logger.error(f"Failed to get Pinecone stats: {str(e)}")
            return {"error": str(e)}
