
import { useState, useCallback, useEffect } from "react"
import { ragService, Document, DocumentStatus } from "@/lib/rag-service"
import { useKnowledgeBase } from "@/context/knowledge-base-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Upload,
  FileText,
  X,
  CheckCircle,
  AlertCircle,
  Search,
  Trash2,
  Download,
  FileUp,
  HardDrive,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface UploadedDocument extends Document {
  progress?: number
  indexed: boolean
}

const ICON_CLASS = "w-6 h-6 text-muted-foreground"

export function DocumentsSection() {
  const knowledgeBase = useKnowledgeBase()
  const [dragActive, setDragActive] = useState(false)
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [hasLoaded, setHasLoaded] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [documentToDelete, setDocumentToDelete] = useState<{ id: string; name: string } | null>(null)
  const [deleteMultipleDialogOpen, setDeleteMultipleDialogOpen] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  const toUploadedDocument = useCallback(
    (document: Document, extras: Partial<UploadedDocument> = {}): UploadedDocument => {
      const baseProgress: Record<DocumentStatus, number> = {
        uploading: 30,
        processing: 60,
        indexing: 85,
        ready: 100,
        index_failed: 100,
        error: 0,
      }

      // Determine if document is truly indexed
      const isIndexed = document.status === 'ready' && Boolean((document.totalChunks ?? 0) > 0)

      const merged = {
        ...document,
        progress: extras.progress ?? baseProgress[document.status ?? "ready"],
        indexed: extras.indexed ?? isIndexed,
      }

      return { ...merged, ...extras }
    },
    []
  )

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await ragService.fetchDocuments()
      console.log("Fetched documents:", docs)
      setDocuments(docs.map((doc) => toUploadedDocument(doc)))
      setHasLoaded(true)
      setSelectedDocuments([])
    } catch (error) {
      console.error("Error fetching documents:", error)
      setHasLoaded(true)
      setDocuments([])
    }
  }, [toUploadedDocument])

  // Lazy load knowledge base data when this section mounts
  useEffect(() => {
    // Load knowledge base if not already loaded
    if (!knowledgeBase.hasLoaded && !knowledgeBase.isLoading) {
      void knowledgeBase.load()
    }
    // Then load documents
    void loadDocuments()
  }, [loadDocuments, knowledgeBase])

  // Polling effect for documents that are still indexing
  // Optimized: polls every 3s and stops after 5 minutes
  useEffect(() => {
    const now = Date.now()
    const FIVE_MINUTES = 300000 // 5 minutes in ms
    const POLL_INTERVAL = 3000 // 3 seconds - más frecuente para mejor UX

    // Filter documents that are indexing and haven't timed out yet
    const indexingDocs = documents.filter(doc => {
      if (doc.status !== 'indexing') return false

      // Stop polling documents that have been indexing for more than 5 minutes
      const timeSinceUpload = now - doc.uploadedAt.getTime()
      return timeSinceUpload < FIVE_MINUTES
    })

    if (indexingDocs.length === 0) {
      return
    }

    const pollInterval = setInterval(async () => {
      const currentTime = Date.now()

      for (const doc of indexingDocs) {
        // Double-check timeout before polling
        const timeSinceUpload = currentTime - doc.uploadedAt.getTime()
        if (timeSinceUpload >= FIVE_MINUTES) {
          // Mark as failed if still indexing after 5 minutes
          setDocuments(prev =>
            prev.map(d =>
              d.id === doc.id
                ? {
                    ...d,
                    status: 'index_failed' as DocumentStatus,
                    indexed: false,
                  }
                : d
            )
          )
          continue
        }

        try {
          const statusResult = await ragService.checkDocumentStatus(doc.id)

          // Update document status if it changed
          if (statusResult.status !== 'indexing') {
            setDocuments(prev =>
              prev.map(d =>
                d.id === doc.id
                  ? {
                      ...d,
                      status: statusResult.status,
                      indexed: statusResult.indexed,
                      progress: statusResult.status === 'ready' ? 100 : d.progress,
                    }
                  : d
              )
            )
          }
        } catch (error) {
          console.error(`Error polling status for document ${doc.id}:`, error)
        }
      }
    }, POLL_INTERVAL)

    return () => clearInterval(pollInterval)
  }, [documents])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const droppedFiles = Array.from(e.dataTransfer.files)
    void handleFiles(droppedFiles)
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files)
      void handleFiles(selectedFiles)
    }
  }

  const handleFiles = async (fileList: File[]) => {
    setUploadError(null)

    for (const file of fileList) {
      if (file.size > 50 * 1024 * 1024) {
        setUploadError(`${file.name} excede el tamaño máximo de 50MB`)
        continue
      }

      await uploadDocumentToService(file)
    }
  }

  const uploadDocumentToService = async (file: File) => {
    const provisionalId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const provisionalDocument: UploadedDocument = {
      id: provisionalId,
      name: file.name,
      size: file.size,
      uploadedAt: new Date(),
      status: "uploading",
      type: file.type || "application/octet-stream",
      indexed: false,
      progress: 0,
    }

    setDocuments((prev) => [provisionalDocument, ...prev])

    try {
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === provisionalId
            ? { ...doc, status: "uploading", progress: 30 }
            : doc
        )
      )

      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === provisionalId
            ? { ...doc, status: "processing", progress: 60 }
            : doc
        )
      )

      const backendDocument = await ragService.uploadDocument(file)

      // Determinar estado basado en la respuesta del backend
      const isIndexed = backendDocument.status === 'ready'
      const progress = backendDocument.status === 'ready' ? 100 :
                       backendDocument.status === 'indexing' ? 85 :
                       backendDocument.status === 'processing' ? 60 : 50

      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === provisionalId
            ? toUploadedDocument(backendDocument, {
                status: backendDocument.status,
                progress: progress,
                indexed: isIndexed,
              })
            : doc
        )
      )

      // Si está indexing, el polling se encargará de actualizarlo
      if (backendDocument.status === 'indexing') {
        console.log(`Document ${backendDocument.id} is indexing. Polling will update status.`)
      }

      setSelectedDocuments((prev) =>
        prev.map((id) => (id === provisionalId ? backendDocument.id : id))
      )

      setUploadError(null)
      setHasLoaded(true)
    } catch (error) {
      console.error("Error uploading document:", error)
      const message = error instanceof Error ? error.message : "Error desconocido al subir el archivo"

      // Si es un timeout, no eliminar el documento sino marcarlo como indexing
      // para que el polling lo maneje
      if (message.includes('tardando más de lo esperado')) {
        setUploadError(`${file.name}: ${message} Usa el botón "Refrescar lista" en unos segundos para ver el estado actualizado.`)
        setDocuments((prev) =>
          prev.map((doc) =>
            doc.id === provisionalId
              ? { ...doc, status: "indexing" as DocumentStatus, progress: 85 }
              : doc
          )
        )
      } else {
        setUploadError(message)
        setDocuments((prev) => prev.filter((doc) => doc.id !== provisionalId))
      }
    }
  }

  const canInteract = hasLoaded

  const openDeleteDialog = (docId: string, docName: string) => {
    setDocumentToDelete({ id: docId, name: docName })
    setDeleteDialogOpen(true)
  }

  const confirmDeleteDocument = async () => {
    if (!canInteract || !documentToDelete) return

    try {
      console.log("Deleting document with ID:", documentToDelete.id)
      await ragService.deleteDocument(documentToDelete.id)
      setDocuments((prev) => prev.filter((doc) => doc.id !== documentToDelete.id))
      setSelectedDocuments((prev) => prev.filter((id) => id !== documentToDelete.id))
      setDeleteDialogOpen(false)
      setDocumentToDelete(null)
    } catch (error) {
      console.error("Error deleting document:", error)
      const message = error instanceof Error ? error.message : "Error al eliminar el documento"
      setUploadError(message)
      setDeleteDialogOpen(false)
      setDocumentToDelete(null)
    }
  }

  const toggleDocumentSelection = (docId: string) => {
    if (!canInteract) return

    setSelectedDocuments((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    )
  }

  const openDeleteMultipleDialog = () => {
    setDeleteMultipleDialogOpen(true)
  }

  const confirmDeleteSelectedDocuments = async () => {
    if (!canInteract) return

    try {
      await Promise.all(selectedDocuments.map((id) => ragService.deleteDocument(id)))
      setDocuments((prev) => prev.filter((doc) => !selectedDocuments.includes(doc.id)))
      setSelectedDocuments([])
      setDeleteMultipleDialogOpen(false)
    } catch (error) {
      console.error("Error deleting selected documents:", error)
      const message = error instanceof Error ? error.message : "Error al eliminar documentos"
      setUploadError(message)
      setDeleteMultipleDialogOpen(false)
    }
  }

  const downloadDocument = async (doc: UploadedDocument) => {
    if (!canInteract) return

    try {
      const { blob, filename } = await ragService.downloadDocument(doc.id)
      const anchor = document.createElement("a")
      const url = URL.createObjectURL(blob)
      anchor.href = url
      anchor.download = filename || doc.name
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Error downloading document:", error)
      const message = error instanceof Error ? error.message : "No se pudo descargar el documento"
      setUploadError(message)
    }
  }

  const syncDocuments = async () => {
    if (!canInteract || isSyncing) return

    setIsSyncing(true)
    setSyncMessage(null)
    setUploadError(null)

    try {
      console.log("Starting document synchronization...")
      const result = await ragService.syncDocuments()

      console.log("Sync result:", result)

      const { summary } = result

      // Crear mensaje de resumen
      let message = `Sincronización completada: `
      const parts: string[] = []

      if (summary.stale_detected > 0) {
        parts.push(`${summary.stale_detected} documento(s) estancado(s) detectado(s)`)
      }
      if (summary.reindex_succeeded > 0) {
        parts.push(`${summary.reindex_succeeded} reindexado(s) exitosamente`)
      }
      if (summary.reindex_failed > 0) {
        parts.push(`${summary.reindex_failed} falló(s) al reindexar`)
      }
      if (summary.marked_as_failed > 0) {
        parts.push(`${summary.marked_as_failed} marcado(s) como fallido(s)`)
      }

      if (parts.length === 0) {
        message += "No se encontraron problemas"
      } else {
        message += parts.join(", ")
      }

      setSyncMessage(message)

      // Recargar documentos después de sincronizar
      await loadDocuments()

    } catch (error) {
      console.error("Error syncing documents:", error)
      const message = error instanceof Error ? error.message : "Error al sincronizar documentos"
      setUploadError(message)
    } finally {
      setIsSyncing(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (!bytes) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
  }

  const getFileIcon = (type: string) => {
    const normalizedType = type?.toLowerCase() ?? ""

    if (normalizedType.includes("pdf")) {
      return <FileText className={`${ICON_CLASS} text-red-500`} />
    }

    if (normalizedType.includes("word") || normalizedType.includes("doc")) {
      return <FileUp className={`${ICON_CLASS} text-blue-500`} />
    }

    if (normalizedType.includes("sheet") || normalizedType.includes("excel")) {
      return <HardDrive className={`${ICON_CLASS} text-green-500`} />
    }

    return <FileText className={ICON_CLASS} />
  }

  const filteredDocuments = documents.filter((doc) =>
    doc.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const totalSize = documents.reduce((acc, doc) => acc + (doc.size ?? 0), 0)
  const readyDocuments = documents.filter((doc) => doc.status === "ready").length
  const processingDocuments = documents.filter((doc) => doc.status === "processing" || doc.status === "uploading" || doc.status === "indexing").length

  return (
    <div className="h-full flex flex-col overflow-hidden max-w-full">
      <div className="px-4 md:px-8 lg:px-12 py-6 mb-6 flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-semibold text-foreground">Documentos</h2>
            <p className="text-sm text-muted-foreground">
              Gestiona los documentos de tu base de conocimiento
            </p>
          </div>
          {hasLoaded && selectedDocuments.length > 0 && (
            <Button variant="destructive" size="sm" onClick={openDeleteMultipleDialog}>
              <Trash2 className="w-4 h-4 mr-2" />
              Eliminar Seleccionados ({selectedDocuments.length})
            </Button>
          )}
        </div>

        {uploadError && (
          <Card className="mb-4 border-red-200 bg-red-50">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-900">Error en la operación</p>
                  <p className="text-sm text-red-700">{uploadError}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setUploadError(null)}
                  className="w-8 h-8 p-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {syncMessage && (
          <Card className="mb-4 border-green-200 bg-green-50">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-900">Sincronización exitosa</p>
                  <p className="text-sm text-green-700">{syncMessage}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSyncMessage(null)}
                  className="w-8 h-8 p-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Documentos</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground">{documents.length}</p>
              <p className="text-xs text-muted-foreground">Documentos registrados en el sistema</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Listos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="w-5 h-5" />
                <p className="text-2xl font-bold">{readyDocuments}</p>
              </div>
              <p className="text-xs text-muted-foreground">Documentos disponibles para búsqueda</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Procesando</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-amber-600">
                <Upload className="w-4 h-4" />
                <p className="text-2xl font-bold">{processingDocuments}</p>
              </div>
              <p className="text-xs text-muted-foreground">En cola de embeddings e indexación</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Tamaño total</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-primary">
                <HardDrive className="w-4 h-4" />
                <p className="text-2xl font-bold">{formatFileSize(totalSize)}</p>
              </div>
              <p className="text-xs text-muted-foreground">Uso acumulado de almacenamiento</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator className="my-4" />

      <div className="flex-1 overflow-hidden px-4 md:px-8 lg:px-12">
        <div className="h-full grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-4 lg:gap-6 max-w-full overflow-hidden">
        <div className="space-y-4 overflow-y-auto pr-2 max-w-full">
          <Card
            className={cn(
              "border-dashed border-2 flex flex-col items-center justify-center min-h-[220px] p-4 text-center w-full",
              dragActive ? "border-primary bg-primary/5" : "border-border"
            )}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="w-10 h-10 text-primary mb-3" />
            <h3 className="text-base font-semibold text-foreground">Sube tus documentos</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Arrastra archivos o selecciona desde tu PC
            </p>
            <div className="flex flex-col gap-2 w-full">
              <label className="relative inline-flex items-center justify-center px-4 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-md cursor-pointer hover:bg-primary/90 w-full">
                <FileUp className="w-3 h-3 mr-2" />
                Seleccionar archivos
                <input
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  accept=".pdf,.txt,.docx"
                />
              </label>
              <Button variant="outline" size="sm" onClick={() => void loadDocuments()} disabled={!canInteract} className="w-full text-xs">
                Refrescar lista
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void syncDocuments()}
                disabled={!canInteract || isSyncing}
                className="w-full text-xs"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    Sincronizando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3 h-3 mr-2" />
                    Sincronizar
                  </>
                )}
              </Button>
            </div>
          </Card>

          <Card className="w-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs">Instrucciones</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <ul className="text-xs text-muted-foreground space-y-1.5">
                <li>• Máximo 50MB</li>
                <li>• Hasta 100 archivos</li>
                <li>• Indexación automática</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden max-w-full">
          <div className="mb-4 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar documentos..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <Card className="flex-1 flex flex-col overflow-hidden w-full">
            <CardHeader>
              <CardTitle className="text-lg">Lista de Documentos</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-hidden w-full">
              {!hasLoaded ? (
                <div className="h-full flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Cargando documentos...</p>
                  </div>
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center p-6">
                    <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {searchTerm ? "No se encontraron documentos con ese nombre" : "No hay documentos cargados todavía"}
                    </p>
                  </div>
                </div>
              ) : (
              <ScrollArea className="h-full">
                <div className="space-y-1">
                  {filteredDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className={cn(
                        "flex items-center gap-4 p-4 hover:bg-muted transition-colors border-b border-border",
                        hasLoaded && selectedDocuments.includes(doc.id) && "bg-muted"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={hasLoaded && selectedDocuments.includes(doc.id)}
                        onChange={() => toggleDocumentSelection(doc.id)}
                        className="w-4 h-4"
                        disabled={!canInteract}
                      />

                      <div className="flex items-center justify-center w-10 h-10 rounded-md bg-muted/50">
                        {getFileIcon(doc.mimeType || doc.type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col gap-1 mb-1 sm:flex-row sm:items-center sm:gap-2 sm:justify-between">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <p className="w-full text-sm font-medium text-foreground truncate sm:flex-1 sm:min-w-0 cursor-default">
                                {doc.name}
                              </p>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-xs break-words">{doc.name}</p>
                            </TooltipContent>
                          </Tooltip>
                          <div className="flex items-center gap-2 sm:flex-shrink-0">
                            {doc.indexed && (
                              <Badge variant="default" className="text-xs">
                                Indexado
                              </Badge>
                            )}
                            <Badge
                              variant={
                                doc.status === 'ready'
                                  ? 'default'
                                  : doc.status === 'error' || doc.status === 'index_failed'
                                  ? 'destructive'
                                  : 'secondary'
                              }
                            >
                              {doc.status === 'uploading'
                                ? 'Subiendo'
                                : doc.status === 'processing'
                                ? 'Procesando'
                                : doc.status === 'indexing'
                                ? 'Indexando'
                                : doc.status === 'ready'
                                ? 'Listo'
                                : doc.status === 'index_failed'
                                ? 'Indexación falló'
                                : 'Error'}
                            </Badge>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {formatFileSize(doc.size)} � {doc.uploadedAt.toLocaleDateString()}
                            {doc.totalChunks ? ` � ${doc.totalChunks} chunks` : ''}
                          </span>
                        </div>

                        {(doc.status === 'uploading' || doc.status === 'processing' || doc.status === 'indexing') && (
                          <Progress value={doc.progress ?? 0} className="mt-2 h-1" />
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-8 h-8 p-0"
                          onClick={() => void downloadDocument(doc)}
                          disabled={!canInteract || doc.status !== 'ready'}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-8 h-8 p-0 text-red-600"
                          onClick={() => openDeleteDialog(doc.id, doc.name)}
                          disabled={!canInteract}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
        </div>
      </div>

      {/* Delete Single Document Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar documento?</AlertDialogTitle>
            <AlertDialogDescription>
              Estás a punto de eliminar <strong>{documentToDelete?.name}</strong>.
              Esta acción no se puede deshacer y eliminará permanentemente el documento,
              sus chunks procesados y sus embeddings del sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDeleteDocument()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Multiple Documents Dialog */}
      <AlertDialog open={deleteMultipleDialogOpen} onOpenChange={setDeleteMultipleDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {selectedDocuments.length} documentos?</AlertDialogTitle>
            <AlertDialogDescription>
              Estás a punto de eliminar {selectedDocuments.length} documento(s) seleccionado(s).
              Esta acción no se puede deshacer y eliminará permanentemente todos los documentos,
              sus chunks procesados y sus embeddings del sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDeleteSelectedDocuments()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar todos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
