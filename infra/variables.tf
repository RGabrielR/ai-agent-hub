# Variables de configuración para la infraestructura RAG

variable "project_id" {
  description = "ID del proyecto de Google Cloud Platform"
  type        = string
}

variable "region" {
  description = "Región de GCP"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Ambiente de despliegue (dev, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Environment debe ser dev o prod."
  }
}

variable "bucket_lifecycle_days" {
  description = "Días después de los cuales eliminar documentos del bucket"
  type        = number
  default     = 365
}

variable "allowed_cors_origins" {
  description = "Orígenes permitidos para CORS — especificar tu dominio de Vercel en producción"
  type        = list(string)
  default     = ["http://localhost:5173"]
  # PRODUCCIÓN: ["https://tu-app.vercel.app"]
}

variable "docker_image_tag" {
  description = "Tag de las imágenes Docker"
  type        = string
  default     = "latest"
}

# ==================== SECRETOS (marcar como sensitive) ====================

variable "pinecone_api_key" {
  description = "API Key de Pinecone para vector storage (free tier)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "genai_api_key" {
  description = "API Key de Google AI Studio (Gemini API — free tier)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "backend_api_key" {
  description = "Clave secreta compartida entre frontend y backends para autenticación"
  type        = string
  sensitive   = true
  default     = ""
  # Generar con: openssl rand -hex 32
}
