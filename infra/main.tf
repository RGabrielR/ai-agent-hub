# Infraestructura RAG — costo cercano a cero, sin Vertex AI Index
terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# APIs necesarias (Vertex AI Matching Engine eliminado — usa Pinecone en su lugar)
resource "google_project_service" "apis" {
  for_each = toset([
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "storage.googleapis.com",
    "bigquery.googleapis.com",
    "aiplatform.googleapis.com",  # Solo para embeddings text-embedding-004, NO para índice vectorial
    "iam.googleapis.com",
    "logging.googleapis.com",
    "artifactregistry.googleapis.com"
  ])

  service = each.value
  project = var.project_id

  disable_dependent_services = false
  disable_on_destroy         = false
}

# Artifact Registry para imágenes Docker
resource "google_artifact_registry_repository" "docker_repo" {
  location      = var.region
  repository_id = "cloud-run-source-deploy"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# Cuenta de servicio con permisos mínimos
resource "google_service_account" "rag_agent_sa" {
  account_id   = "rag-agent-service"
  display_name = "RAG Agent Service Account"
  description  = "Service account para el agente RAG con permisos mínimos necesarios"

  depends_on = [google_project_service.apis]
}

# Bucket de Cloud Storage para documentos
resource "google_storage_bucket" "documents_bucket" {
  name     = "${var.project_id}-rag-documents"
  location = var.region

  uniform_bucket_level_access = true  # Sin acceso público al bucket

  versioning {
    enabled = false  # Sin versioning para ahorrar almacenamiento
  }

  lifecycle_rule {
    condition {
      age = var.bucket_lifecycle_days
    }
    action {
      type = "Delete"
    }
  }

  cors {
    origin          = var.allowed_cors_origins
    method          = ["GET", "HEAD", "PUT", "POST", "DELETE"]
    response_header = ["Content-Type", "X-API-Key"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.apis]
}

# Dataset de BigQuery para historial de chats
resource "google_bigquery_dataset" "chat_history" {
  dataset_id  = "rag_chat_history"
  description = "Historial de conversaciones del agente RAG"
  location    = var.region

  access {
    role          = "OWNER"
    user_by_email = google_service_account.rag_agent_sa.email
  }

  delete_contents_on_destroy = false

  depends_on = [google_project_service.apis]
}

# Tabla de BigQuery para conversaciones
resource "google_bigquery_table" "conversations" {
  dataset_id          = google_bigquery_dataset.chat_history.dataset_id
  table_id            = "conversations"
  deletion_protection = false

  schema = jsonencode([
    { name = "conversation_id", type = "STRING", mode = "REQUIRED" },
    { name = "user_id",         type = "STRING", mode = "NULLABLE" },
    { name = "message_type",    type = "STRING", mode = "REQUIRED", description = "user or assistant" },
    { name = "content",         type = "STRING", mode = "REQUIRED" },
    { name = "timestamp",       type = "TIMESTAMP", mode = "REQUIRED" },
    { name = "metadata",        type = "JSON",   mode = "NULLABLE" }
  ])

  time_partitioning {
    type  = "DAY"
    field = "timestamp"
  }

  depends_on = [google_bigquery_dataset.chat_history]
}

# Cloud Run — Document Processor
resource "google_cloud_run_v2_service" "document_processor" {
  name     = "rag-document-processor"
  location = var.region

  template {
    service_account = google_service_account.rag_agent_sa.email

    annotations = {
      "run.googleapis.com/cpu-throttling" = "true"
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/cloud-run-source-deploy/rag-document-processor:latest"

      env { name = "PROJECT_ID";      value = var.project_id }
      env { name = "BUCKET_NAME";     value = google_storage_bucket.documents_bucket.name }
      env { name = "REGION";          value = var.region }
      env { name = "PINECONE_API_KEY"; value = var.pinecone_api_key }
      env { name = "GENAI_API_KEY";   value = var.genai_api_key }
      env { name = "BACKEND_API_KEY"; value = var.backend_api_key }
      env { name = "ALLOWED_ORIGINS"; value = join(",", var.allowed_cors_origins) }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      ports {
        container_port = 8080
      }
    }

    scaling {
      min_instance_count = 0  # Scale to zero — sin costo cuando no se usa
      max_instance_count = 2  # Cap duro para evitar costos inesperados
    }
  }

  depends_on = [
    google_project_service.apis,
    google_service_account.rag_agent_sa,
    google_artifact_registry_repository.docker_repo
  ]
}

# Cloud Run — RAG Backend
resource "google_cloud_run_v2_service" "rag_backend" {
  name     = "rag-agent-backend"
  location = var.region

  template {
    service_account = google_service_account.rag_agent_sa.email

    annotations = {
      "run.googleapis.com/cpu-throttling" = "true"
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/cloud-run-source-deploy/rag-agent-backend:latest"

      env { name = "PROJECT_ID";      value = var.project_id }
      env { name = "DATASET_ID";      value = google_bigquery_dataset.chat_history.dataset_id }
      env { name = "TABLE_ID";        value = google_bigquery_table.conversations.table_id }
      env { name = "BUCKET_NAME";     value = google_storage_bucket.documents_bucket.name }
      env { name = "REGION";          value = var.region }
      env { name = "MODEL_NAME";      value = "models/gemini-2.5-flash" }
      env { name = "PINECONE_API_KEY"; value = var.pinecone_api_key }
      env { name = "GENAI_API_KEY";   value = var.genai_api_key }
      env { name = "BACKEND_API_KEY"; value = var.backend_api_key }
      env { name = "ALLOWED_ORIGINS"; value = join(",", var.allowed_cors_origins) }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      ports {
        container_port = 8080
      }
    }

    scaling {
      min_instance_count = 0  # Scale to zero — sin costo cuando no se usa
      max_instance_count = 2  # Cap duro para evitar costos inesperados
    }
  }

  depends_on = [
    google_project_service.apis,
    google_service_account.rag_agent_sa,
    google_bigquery_table.conversations,
    google_artifact_registry_repository.docker_repo
  ]
}

# IAM — permisos mínimos necesarios
resource "google_project_iam_member" "rag_storage_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.rag_agent_sa.email}"
}

resource "google_project_iam_member" "rag_bigquery_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.rag_agent_sa.email}"
}

resource "google_project_iam_member" "rag_bigquery_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.rag_agent_sa.email}"
}

resource "google_project_iam_member" "rag_vertex_ai_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"  # Solo para text-embedding-004, no para índice
  member  = "serviceAccount:${google_service_account.rag_agent_sa.email}"
}

resource "google_project_iam_member" "rag_logging_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.rag_agent_sa.email}"
}

# Acceso público a Cloud Run (la seguridad se maneja con BACKEND_API_KEY a nivel de app)
resource "google_cloud_run_v2_service_iam_member" "document_processor_public" {
  name     = google_cloud_run_v2_service.document_processor.name
  location = google_cloud_run_v2_service.document_processor.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "rag_backend_public" {
  name     = google_cloud_run_v2_service.rag_backend.name
  location = google_cloud_run_v2_service.rag_backend.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
