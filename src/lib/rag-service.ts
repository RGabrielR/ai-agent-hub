// RAG Service - Cliente real para servicios backend en GCP
// Conecta con Document Processor y RAG Backend en Cloud Run

export type DocumentStatus = 'uploading' | 'processing' | 'indexing' | 'ready' | 'index_failed' | 'error'

export interface Document {
  id: string
  name: string
  size: number
  uploadedAt: Date
  status: DocumentStatus
  type: string
  mimeType?: string
  totalChunks?: number
  totalCharacters?: number
  uris?: {
    document?: string
    chunks?: string
    embeddings?: string
    metadata?: string
  }
}

export interface ChatMessage {
  id: string
  type: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: string[]
  confidence?: number
}

export interface TokenUsage {
  prompt_tokens?: number
  response_tokens?: number
  total_tokens?: number
}

export interface RAGResponse {
  answer: string
  sources: string[]
  confidence: number
  conversation_id?: string
  metadata?: {
    chunks_retrieved?: number
    model_used?: string
    latency_ms?: number | null
    token_usage?: TokenUsage
  }
}

export interface KnowledgeBaseAnalyticsSummary {
  totalQueries: number
  avgLatencyMs: number
  avgTotalTokens: number
  avgPromptTokens: number
  avgResponseTokens: number
  totalTokens: number
}

export interface KnowledgeBaseAnalytics {
  summary: KnowledgeBaseAnalyticsSummary
  documents: Array<{
    documentId: string
    queryCount: number
  }>
}

interface SavedSettings {
  systemPrompt?: string
  responseLanguage?: string
  selectedModel?: string
}

// Configuración de URLs y seguridad desde variables de entorno
const DOCUMENT_PROCESSOR_URL = import.meta.env.VITE_DOCUMENT_PROCESSOR_URL || ''
const RAG_BACKEND_URL = import.meta.env.VITE_RAG_BACKEND_URL || ''
const BACKEND_API_KEY = import.meta.env.VITE_BACKEND_API_KEY || ''

/** Headers base con API key para todos los requests al backend */
const apiHeaders = (): Record<string, string> =>
  BACKEND_API_KEY ? { 'X-API-Key': BACKEND_API_KEY } : {}

class RAGService {
  private documents: Document[] = []
  private currentConversationId: string | null = null

  // Request deduplication and caching
  private documentsFetchPromise: Promise<Document[]> | null = null
  private lastDocumentsFetch: number = 0
  private conversationsCache: any[] = []
  private conversationsListPromise: Promise<any[]> | null = null
  private lastConversationsList: number = 0
  private lastConversationsLimit: number = 0
  private analyticsCache: KnowledgeBaseAnalytics | null = null
  private analyticsPromise: Promise<KnowledgeBaseAnalytics> | null = null
  private lastAnalyticsFetch: number = 0
  private readonly CACHE_DURATION = 30000 // 30 seconds

  private normalizeDocument(data: any): Document {
    const uploadedAt = data.uploaded_at ?? data.uploadedAt ?? new Date().toISOString()
    const status = (data.status ?? 'ready') as DocumentStatus

    const generatedId = (globalThis.crypto?.randomUUID?.() as string | undefined) ?? `temp_${Math.random().toString(36).slice(2)}`

    return {
      id: data.document_id ?? data.id ?? generatedId,
      name: data.filename ?? data.name ?? 'Documento',
      size: Number(data.size ?? 0),
      uploadedAt: new Date(uploadedAt),
      status,
      type: data.document_type ?? data.type ?? 'application/octet-stream',
      mimeType: data.mime_type ?? data.mimeType,
      totalChunks: data.total_chunks ?? data.totalChunks,
      totalCharacters: data.total_characters ?? data.totalCharacters,
      uris: data.uris ?? {},
    }
  }

  private upsertDocument(document: Document): Document {
    const index = this.documents.findIndex((doc) => doc.id === document.id)

    if (index >= 0) {
      this.documents.splice(index, 1, document)
    } else {
      this.documents = [document, ...this.documents]
    }

    return document
  }

  /**
   * Sube un documento al Document Processor
   */
  async uploadDocument(file: File): Promise<Document> {
    try {
      const formData = new FormData()
      formData.append('file', file)

      console.log('Uploading document to:', `${DOCUMENT_PROCESSOR_URL}/upload`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 120000) // 2 minutos timeout

      const response = await fetch(`${DOCUMENT_PROCESSOR_URL}/upload`, {
        method: 'POST',
        headers: apiHeaders(),
        body: formData,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const contentType = response.headers.get('content-type')

        if (contentType && contentType.includes('application/json')) {
          const error = await response.json()
          throw new Error(error.error || `Error ${response.status}: ${response.statusText}`)
        }

        const htmlError = await response.text()
        console.error('HTML Error Response:', htmlError)
        throw new Error(`Error ${response.status}: El servidor backend no está disponible o no tiene permisos configurados correctamente`)
      }

      const result = await response.json()
      const document = this.normalizeDocument({
        ...result,
        size: result.size ?? file.size,
        filename: result.filename ?? file.name,
        document_type: result.document_type ?? file.type,
      })

      this.upsertDocument(document)
      console.log('Document uploaded successfully:', document)
      return document
    } catch (error) {
      console.error('Error uploading document:', error)

      // Manejar errores de timeout específicamente
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('El procesamiento del documento está tardando más de lo esperado. El documento se está procesando en segundo plano.')
      }

      const message = error instanceof Error ? error : new Error('Error uploading document')
      throw message
    }
  }

  async fetchDocuments(): Promise<Document[]> {
    const now = Date.now()

    // Return cached data if fresh (< 30s old)
    if (this.documents.length > 0 && now - this.lastDocumentsFetch < this.CACHE_DURATION) {
      return this.documents
    }

    // Deduplicate concurrent requests
    if (this.documentsFetchPromise) {
      return this.documentsFetchPromise
    }

    this.documentsFetchPromise = this._fetchDocumentsInternal()

    try {
      const result = await this.documentsFetchPromise
      this.lastDocumentsFetch = now
      return result
    } finally {
      this.documentsFetchPromise = null
    }
  }

  private async _fetchDocumentsInternal(): Promise<Document[]> {
    try {
      const response = await fetch(`${DOCUMENT_PROCESSOR_URL}/documents`, {
        method: 'GET',
        headers: apiHeaders(),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || `Error ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      const documentsArray = Array.isArray(result.documents) ? result.documents : []
      this.documents = documentsArray
        .map((item: Document) => this.normalizeDocument(item))
        .sort((a: Document, b: Document) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
      return this.documents
    } catch (error) {
      console.error('Error fetching documents:', error)
      const message = error instanceof Error ? error : new Error('Error fetching documents')
      throw message
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    try {
      const response = await fetch(`${DOCUMENT_PROCESSOR_URL}/documents/${documentId}`, {
        method: 'DELETE',
        headers: apiHeaders(),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || `Error ${response.status}: ${response.statusText}`)
      }

      this.documents = this.documents.filter((doc) => doc.id !== documentId)
    } catch (error) {
      console.error('Error deleting document:', error)
      const message = error instanceof Error ? error : new Error('Error deleting document')
      throw message
    }
  }

  async downloadDocument(documentId: string): Promise<{ blob: Blob; filename: string }> {
    try {
      const response = await fetch(`${DOCUMENT_PROCESSOR_URL}/documents/${documentId}/download`, {
        method: 'GET',
        headers: apiHeaders(),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || `Error ${response.status}: ${response.statusText}`)
      }

      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      let filename = `document-${documentId}`
      const match = disposition.match(/filename="?([^";]+)"?/i)
      if (match && match[1]) {
        try {
          filename = decodeURIComponent(match[1])
        } catch {
          filename = match[1]
        }
      }

      return { blob, filename }
    } catch (error) {
      console.error('Error downloading document:', error)
      const message = error instanceof Error ? error : new Error('Error downloading document')
      throw message
    }
  }

  /**
   * Sincroniza documentos estancados o con problemas
   * Detecta documentos en estado 'indexing' por más de 5 minutos y los reindexa o marca como fallidos
   */
  async syncDocuments(): Promise<{
    status: string
    summary: {
      total_documents: number
      stale_detected: number
      chunks_missing: number
      reindex_attempted: number
      reindex_succeeded: number
      reindex_failed: number
      marked_as_failed: number
      details: Array<{
        document_id: string
        filename: string
        action: string
        status?: string
        error?: string
        reason?: string
      }>
    }
  }> {
    try {
      const response = await fetch(`${DOCUMENT_PROCESSOR_URL}/documents/sync`, {
        method: 'POST',
        headers: apiHeaders(),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || `Error ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      return result
    } catch (error) {
      console.error('Error syncing documents:', error)
      const message = error instanceof Error ? error : new Error('Error syncing documents')
      throw message
    }
  }

  /**
   * Consulta el estado de indexación de un documento
   */
  async checkDocumentStatus(documentId: string): Promise<{ status: DocumentStatus; indexed: boolean; filename: string }> {
    try {
      const response = await fetch(`${DOCUMENT_PROCESSOR_URL}/documents/${documentId}/status`, {
        method: 'GET',
        headers: apiHeaders(),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || `Error ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()

      // Update local document if it exists
      const docIndex = this.documents.findIndex(doc => doc.id === documentId)
      if (docIndex >= 0) {
        this.documents[docIndex] = {
          ...this.documents[docIndex],
          status: result.status as DocumentStatus,
        }
      }

      return {
        status: result.status as DocumentStatus,
        indexed: result.indexed ?? false,
        filename: result.filename ?? ''
      }
    } catch (error) {
      console.error('Error checking document status:', error)
      const message = error instanceof Error ? error : new Error('Error checking document status')
      throw message
    }
  }

  /**
   * Obtiene la lista de documentos locales
   */
  getDocuments(): Document[] {
    return this.documents
  }

  /**
   * Realiza una consulta al RAG Backend
   */
  async queryDocuments(
    question: string,
    conversationId?: string
  ): Promise<RAGResponse> {
    try {
      const savedSettings = this.getSavedSettings()
      const response = await fetch(`${RAG_BACKEND_URL}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...apiHeaders(),
        },
        body: JSON.stringify({
          question,
          conversation_id: conversationId || this.currentConversationId,
          top_k: 5,
          include_history: true,
          system_prompt: savedSettings?.systemPrompt,
          response_language: savedSettings?.responseLanguage,
          model: savedSettings?.selectedModel
        }),
      })

      if (!response.ok) {
        const contentType = response.headers.get('content-type')

        if (contentType && contentType.includes('application/json')) {
          const error = await response.json()
          throw new Error(error.error || `Error ${response.status}: ${response.statusText}`)
        }

        const textError = await response.text()
        throw new Error(`Error ${response.status}: ${textError || response.statusText}`)
      }

      const result = await response.json()

      // Guardar conversation_id para futuras queries
      if (result.conversation_id) {
        this.currentConversationId = result.conversation_id
      }

      return {
        answer: result.answer,
        sources: result.sources || [],
        confidence: result.confidence || 0.5,
        conversation_id: result.conversation_id,
        metadata: result.metadata
      }

    } catch (error) {
      console.error('Error querying documents:', error)
      throw error
    }
  }

  private getSavedSettings(): SavedSettings | null {
    if (typeof window === 'undefined') {
      return null
    }

    try {
      const stored = window.localStorage.getItem('rag-settings')
      if (!stored) {
        return null
      }
      return JSON.parse(stored) as SavedSettings
    } catch (error) {
      console.error('Error reading saved settings:', error)
      return null
    }
  }

  /**
   * Obtiene el historial de una conversación
   */
  async getConversationHistory(conversationId?: string): Promise<ChatMessage[]> {
    try {
      const convId = conversationId || this.currentConversationId

      if (!convId) {
        return []
      }

      const response = await fetch(`${RAG_BACKEND_URL}/conversations/${convId}`, {
        method: 'GET',
        headers: apiHeaders(),
      })

      if (!response.ok) {
        if (response.status === 404) {
          return []
        }
        const contentType = response.headers.get('content-type')

        if (contentType && contentType.includes('application/json')) {
          const error = await response.json()
          throw new Error(error.error || 'Error fetching conversation history')
        }

        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()

      // Convertir al formato local
      return result.messages.map((msg: any, index: number) => ({
        id: `${msg.type}-${index}`,
        type: msg.type,
        content: msg.content,
        timestamp: new Date(msg.timestamp),
        sources: msg.sources,
        confidence: msg.confidence
      }))

    } catch (error) {
      console.error('Error fetching conversation history:', error)
      return []
    }
  }

  /**
   * Lista todas las conversaciones recientes
   */
  async listConversations(limit: number = 10): Promise<any[]> {
    const now = Date.now()

    // Return cached data if fresh and same limit
    if (
      this.conversationsCache.length > 0 &&
      now - this.lastConversationsList < this.CACHE_DURATION &&
      this.lastConversationsLimit === limit
    ) {
      return this.conversationsCache
    }

    // Deduplicate concurrent requests
    if (this.conversationsListPromise) {
      return this.conversationsListPromise
    }

    this.conversationsListPromise = this._listConversationsInternal(limit)

    try {
      const result = await this.conversationsListPromise
      this.lastConversationsList = now
      this.lastConversationsLimit = limit
      return result
    } finally {
      this.conversationsListPromise = null
    }
  }

  private async _listConversationsInternal(limit: number): Promise<any[]> {
    try {
      const response = await fetch(`${RAG_BACKEND_URL}/conversations?limit=${limit}`, {
        method: 'GET',
        headers: apiHeaders(),
      })

      if (!response.ok) {
        const contentType = response.headers.get('content-type')

        if (contentType && contentType.includes('application/json')) {
          const error = await response.json()
          throw new Error(error.error || 'Error listing conversations')
        }

        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      this.conversationsCache = result.conversations || []
      return this.conversationsCache

    } catch (error) {
      console.error('Error listing conversations:', error)
      return []
    }
  }

  async getKnowledgeBaseAnalytics(options: { days?: number; documentLimit?: number } = {}): Promise<KnowledgeBaseAnalytics> {
    const now = Date.now()

    // Return cached data if fresh (< 30s old)
    if (this.analyticsCache && now - this.lastAnalyticsFetch < this.CACHE_DURATION) {
      return this.analyticsCache
    }

    // Deduplicate concurrent requests
    if (this.analyticsPromise) {
      return this.analyticsPromise
    }

    this.analyticsPromise = this._getKnowledgeBaseAnalyticsInternal(options)

    try {
      const result = await this.analyticsPromise
      this.lastAnalyticsFetch = now
      return result
    } finally {
      this.analyticsPromise = null
    }
  }

  private async _getKnowledgeBaseAnalyticsInternal(options: { days?: number; documentLimit?: number } = {}): Promise<KnowledgeBaseAnalytics> {
    const defaultAnalytics: KnowledgeBaseAnalytics = {
      summary: {
        totalQueries: 0,
        avgLatencyMs: 0,
        avgTotalTokens: 0,
        avgPromptTokens: 0,
        avgResponseTokens: 0,
        totalTokens: 0
      },
      documents: []
    }

    if (!RAG_BACKEND_URL) {
      this.analyticsCache = defaultAnalytics
      return defaultAnalytics
    }

    const params = new URLSearchParams()
    if (options.days !== undefined) {
      params.append('days', String(options.days))
    }
    if (options.documentLimit !== undefined) {
      params.append('document_limit', String(options.documentLimit))
    }

    const queryString = params.toString()
    const sanitizedBaseUrl = RAG_BACKEND_URL.replace(/\/$/, '')
    const candidateEndpoints = [
      `${sanitizedBaseUrl}/analytics/knowledge-base`,
      `${sanitizedBaseUrl}/analytics/knowledge_base`
    ]

    try {
      for (const endpoint of candidateEndpoints) {
        const targetUrl = queryString ? `${endpoint}?${queryString}` : endpoint
        let response: Response

        try {
          response = await fetch(targetUrl, { method: 'GET', headers: apiHeaders() })
        } catch (networkError) {
          console.error('Network error hitting knowledge base analytics:', networkError)
          continue
        }

        if (response.ok) {
          const result = await response.json()
          const summary = result.summary ?? {}
          const documents = Array.isArray(result.documents) ? result.documents : []

          const analytics: KnowledgeBaseAnalytics = {
            summary: {
              totalQueries: Number(summary.total_queries ?? summary.totalQueries ?? 0),
              avgLatencyMs: Number(summary.avg_latency_ms ?? summary.avgLatencyMs ?? 0),
              avgTotalTokens: Number(summary.avg_total_tokens ?? summary.avgTotalTokens ?? 0),
              avgPromptTokens: Number(summary.avg_prompt_tokens ?? summary.avgPromptTokens ?? 0),
              avgResponseTokens: Number(summary.avg_response_tokens ?? summary.avgResponseTokens ?? 0),
              totalTokens: Number(summary.total_tokens ?? summary.totalTokens ?? 0)
            },
            documents: documents.map((item: any) => ({
              documentId: item.document_id ?? item.documentId ?? '',
              queryCount: Number(item.query_count ?? item.queryCount ?? 0)
            })).filter((doc: { documentId: string; queryCount: number }) => doc.documentId)
          }

          this.analyticsCache = analytics
          return analytics
        }

        if (response.status === 404) {
          console.warn(`Knowledge base analytics endpoint not found at ${targetUrl}, trying fallback`)
          continue
        }

        const contentType = response.headers.get('content-type')

        if (contentType && contentType.includes('application/json')) {
          const error = await response.json()
          throw new Error(error.error || 'Error fetching knowledge base analytics')
        }

        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

    } catch (error) {
      console.error('Error fetching knowledge base analytics:', error)
      this.analyticsCache = defaultAnalytics
      return defaultAnalytics
    }

    console.warn('Knowledge base analytics unavailable, returning defaults')
    this.analyticsCache = defaultAnalytics
    return defaultAnalytics
  }

  /**
   * Elimina una conversación
   */
  async deleteConversation(conversationId: string): Promise<boolean> {
    try {
      const response = await fetch(`${RAG_BACKEND_URL}/conversations/${conversationId}`, {
        method: 'DELETE',
        headers: apiHeaders(),
      })

      if (!response.ok) {
        const contentType = response.headers.get('content-type')

        if (contentType && contentType.includes('application/json')) {
          const error = await response.json()
          throw new Error(error.error || 'Error deleting conversation')
        }

        throw new Error(`Error ${response.status}: ${response.statusText}`)
      }

      // Si es la conversación actual, resetearla
      if (this.currentConversationId === conversationId) {
        this.currentConversationId = null
      }

      return true

    } catch (error) {
      console.error('Error deleting conversation:', error)
      return false
    }
  }

  /**
   * Inicia una nueva conversación
   */
  startNewConversation(): void {
    this.currentConversationId = null
  }

  /**
   * Obtiene el ID de la conversación actual
   */
  getCurrentConversationId(): string | null {
    return this.currentConversationId
  }

  /**
   * Health check de los servicios backend
   */
  async healthCheck(): Promise<{
    documentProcessor: boolean
    ragBackend: boolean
  }> {
    const results = {
      documentProcessor: false,
      ragBackend: false
    }

    try {
      const docProcessorResponse = await fetch(`${DOCUMENT_PROCESSOR_URL}/health`, {
        method: 'GET',
      })
      results.documentProcessor = docProcessorResponse.ok

      const ragBackendResponse = await fetch(`${RAG_BACKEND_URL}/health`, {
        method: 'GET',
      })
      results.ragBackend = ragBackendResponse.ok

    } catch (error) {
      console.error('Error checking health:', error)
    }

    return results
  }

  /**
   * Verifica la configuración del servicio
   */
  checkConfiguration(): {
    configured: boolean
    documentProcessorUrl: string
    ragBackendUrl: string
  } {
    return {
      configured: !!(DOCUMENT_PROCESSOR_URL && RAG_BACKEND_URL),
      documentProcessorUrl: DOCUMENT_PROCESSOR_URL,
      ragBackendUrl: RAG_BACKEND_URL
    }
  }

  // Métodos de compatibilidad con la interfaz anterior
  addMessage(_message: ChatMessage): void {
    // No-op: Los mensajes ahora se guardan automáticamente en BigQuery
    console.log('Message will be saved in BigQuery automatically')
  }

  getChatHistory(): ChatMessage[] {
    // Retornar array vacío, usar getConversationHistory() en su lugar
    console.warn('Use getConversationHistory() instead')
    return []
  }

  clearChatHistory(): void {
    this.startNewConversation()
  }

  async initializeBackend(): Promise<{ success: boolean; message: string }> {
    const health = await this.healthCheck()
    const config = this.checkConfiguration()

    if (!config.configured) {
      return {
        success: false,
        message: 'Backend no configurado. Verifica las variables de entorno VITE_DOCUMENT_PROCESSOR_URL y VITE_RAG_BACKEND_URL'
      }
    }

    if (!health.documentProcessor || !health.ragBackend) {
      return {
        success: false,
        message: `Servicios no disponibles. Document Processor: ${health.documentProcessor ? 'OK' : 'Error'}, RAG Backend: ${health.ragBackend ? 'OK' : 'Error'}`
      }
    }

    return {
      success: true,
      message: 'Backend RAG conectado exitosamente a GCP Cloud Run'
    }
  }
}

export const ragService = new RAGService()

// Export types for use in components
export type { Document as RAGDocument, ChatMessage as RAGChatMessage }
