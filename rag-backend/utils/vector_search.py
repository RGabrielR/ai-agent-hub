"""
Vector search helpers backed by Vertex AI Matching Engine.
"""
import os
from typing import List, Dict
import logging

logger = logging.getLogger(__name__)


class VectorSearch:
    """Wrapper around Vertex AI Matching Engine for nearest-neighbour lookups."""

    def __init__(self) -> None:
        # Lazy imports — solo se cargan si se usa Vertex AI Matching Engine
        from google.cloud import aiplatform
        from vertexai.language_models import TextEmbeddingModel

        self.project_id = os.environ.get("PROJECT_ID")
        self.region = os.environ.get("REGION", "us-central1")
        self.index_endpoint = os.environ.get("INDEX_ENDPOINT")
        self.deployed_index_id = os.environ.get("DEPLOYED_INDEX_ID")

        if not self.project_id:
            raise ValueError("PROJECT_ID environment variable is required")

        if not self.index_endpoint:
            raise ValueError("INDEX_ENDPOINT environment variable is required for vector search")

        if not self.deployed_index_id:
            raise ValueError("DEPLOYED_INDEX_ID environment variable is required for vector search")

        aiplatform.init(project=self.project_id, location=self.region)

        embedding_model_name = os.environ.get("EMBEDDING_MODEL_NAME", "text-embedding-004")
        try:
            self.embedding_model = TextEmbeddingModel.from_pretrained(embedding_model_name)  # noqa: F821
            logger.info("Loaded embedding model: %s", embedding_model_name)
        except Exception as exc:
            fallback_name = "text-multilingual-embedding-002"
            logger.warning(
                "Failed to load %s (%s). Trying %s instead.",
                embedding_model_name,
                exc,
                fallback_name,
            )
            self.embedding_model = TextEmbeddingModel.from_pretrained(fallback_name)
            logger.info("Loaded embedding model: %s", fallback_name)

        logger.info(
            "Vector search initialized for project %s using endpoint %s",
            self.project_id,
            self.index_endpoint,
        )

    def search_similar_documents(self, query: str, top_k: int = 5) -> List[Dict[str, float]]:
        """
        Retrieve the closest document chunks for the supplied query.

        Args:
            query: Natural language question from the user.
            top_k: Amount of neighbours to return.

        Returns:
            A list of dictionaries containing ids, distances and scores.
        """
        try:
            logger.info("Generating embedding for query: %s...", query[:50])
            query_embedding = self.embedding_model.get_embeddings([query])[0].values

            endpoint = aiplatform.MatchingEngineIndexEndpoint(
                index_endpoint_name=self.index_endpoint
            )
            response = endpoint.find_neighbors(
                deployed_index_id=self.deployed_index_id,
                queries=[query_embedding],
                num_neighbors=top_k,
            )

            results: List[Dict[str, float]] = []
            if response and response[0]:
                for neighbor in response[0]:
                    results.append(
                        {
                            "id": neighbor.id,
                            "distance": neighbor.distance,
                            "score": 1.0 - neighbor.distance,
                        }
                    )
            logger.info("Found %d similar documents", len(results))
            return results
        except Exception as exc:
            logger.error("Error querying index endpoint: %s", exc)
            raise

    def get_query_embedding(self, query: str) -> List[float]:
        """Return the embedding vector for the supplied query string."""
        embedding = self.embedding_model.get_embeddings([query])[0]
        return embedding.values
