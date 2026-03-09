import { useState, useCallback, useEffect } from "react"
import { ragService } from "@/lib/rag-service"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Upload, FileText, X, CheckCircle, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface UploadedFile {
  id: string
  name: string
  size: number
  status: 'uploading' | 'processed' | 'error' | 'retrying'
  progress: number
  errorMessage?: string
  retryCount?: number
}

export function DocumentUpload() {
  const [dragActive, setDragActive] = useState(false)
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [uploadQueue, setUploadQueue] = useState<File[]>([])
  const [activeUploads, setActiveUploads] = useState(0)
  const MAX_CONCURRENT_UPLOADS = 2 // Limit concurrent uploads

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

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
    handleFiles(droppedFiles)
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files)
      handleFiles(selectedFiles)
    }
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  const handleFiles = (fileList: File[]) => {
    const oversized = fileList.filter(f => f.size > MAX_FILE_SIZE)
    const valid = fileList.filter(f => f.size <= MAX_FILE_SIZE)

    // Mostrar error inmediato para archivos que exceden el límite
    if (oversized.length > 0) {
      const errorEntries: UploadedFile[] = oversized.map(f => ({
        id: Math.random().toString(36).substr(2, 9),
        name: f.name,
        size: f.size,
        status: 'error',
        progress: 0,
        errorMessage: `El archivo supera el límite de 10 MB (${formatFileSize(f.size)})`
      }))
      setFiles(prev => [...prev, ...errorEntries])
    }

    if (valid.length > 0) {
      setUploadQueue(prev => [...prev, ...valid])
    }
  }

  // Process upload queue with concurrency limit
  useEffect(() => {
    if (uploadQueue.length > 0 && activeUploads < MAX_CONCURRENT_UPLOADS) {
      const nextFile = uploadQueue[0]
      setUploadQueue(prev => prev.slice(1))
      processUpload(nextFile)
    }
  }, [uploadQueue, activeUploads])

  const processUpload = async (file: File) => {
    setActiveUploads(prev => prev + 1)
    await uploadFile(file)
    setActiveUploads(prev => prev - 1)
  }

  const uploadFile = async (file: File, retryCount = 0) => {
    const fileId = Math.random().toString(36).substr(2, 9)

    // Add file to list with uploading status
    const newFile = {
      id: fileId,
      name: file.name,
      size: file.size,
      status: 'uploading' as const,
      progress: 0,
      retryCount
    }

    setFiles(prev => [...prev, newFile])

    let progressInterval: NodeJS.Timeout | null = null

    try {
      // Start progress simulation
      progressInterval = setInterval(() => {
        setFiles(prev => prev.map(f => {
          if (f.id === fileId && f.progress < 90) {
            return { ...f, progress: f.progress + 10 }
          }
          return f
        }))
      }, 200)

      // Upload document to backend
      const uploadedDoc = await ragService.uploadDocument(file)

      // Clear progress interval
      if (progressInterval) clearInterval(progressInterval)

      // Mark as processed
      setFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, status: 'processed', progress: 100 } : f
      ))

      console.log('Document uploaded successfully:', uploadedDoc)
    } catch (error) {
      // Clear progress interval on error
      if (progressInterval) clearInterval(progressInterval)

      console.error('Error uploading document:', error)
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido'

      // Check if it's a quota error
      const isQuotaError = errorMessage.includes('quota') ||
                          errorMessage.includes('429') ||
                          errorMessage.includes('concurrent')

      setFiles(prev => prev.map(f =>
        f.id === fileId
          ? {
              ...f,
              status: 'error',
              progress: 0,
              errorMessage: isQuotaError
                ? 'Límite de operaciones concurrentes excedido. El backend reintentará automáticamente.'
                : errorMessage
            }
          : f
      ))
    }
  }

  const removeFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }

  return (
    <div className="h-full flex flex-col">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">Subir Documentos</h2>
        <p className="text-sm text-muted-foreground">
          Sube documentos para construir tu base de conocimiento para el asistente RAG
        </p>
      </div>

      {/* Upload Area */}
      <Card
        className={cn(
          "border-2 border-dashed transition-colors cursor-pointer",
          dragActive ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <CardContent className="p-8 text-center">
          <div className="mb-4">
            <Upload className="w-12 h-12 text-muted-foreground mx-auto" />
          </div>
          <div className="mb-4">
            <p className="text-sm font-medium text-foreground mb-1">
              Arrastra archivos aquí o haz clic para explorar
            </p>
            <p className="text-xs text-muted-foreground">
              PDF, DOCX, TXT — máximo 10 MB por archivo
            </p>
          </div>
          <input
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.txt,.md"
            onChange={handleFileSelect}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload">
            <Button variant="outline" className="cursor-pointer">
              Seleccionar Archivos
            </Button>
          </label>
        </CardContent>
      </Card>

      {/* Uploaded Files List */}
      {files.length > 0 && (
        <div className="mt-6 flex-1">
          <h3 className="text-sm font-medium text-foreground mb-3">Archivos Subidos</h3>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {files.map((file) => (
              <Card key={file.id} className="p-4">
                <div className="flex items-center gap-3">
                  <FileText className="w-8 h-8 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {file.name}
                      </p>
                      <div className="flex items-center gap-2">
                        {file.status === 'processed' && (
                          <CheckCircle className="w-4 h-4 text-green-600" />
                        )}
                        {file.status === 'error' && (
                          <AlertCircle className="w-4 h-4 text-red-600" />
                        )}
                        {file.status === 'retrying' && (
                          <AlertCircle className="w-4 h-4 text-yellow-600" />
                        )}
                        <Badge variant={
                          file.status === 'processed' ? 'default' :
                          file.status === 'error' ? 'destructive' :
                          file.status === 'retrying' ? 'secondary' : 'secondary'
                        }>
                          {file.status === 'uploading' ? 'Procesando' :
                           file.status === 'processed' ? 'Listo' :
                           file.status === 'retrying' ? 'Reintentando' : 'Error'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-6 h-6 p-0"
                          onClick={() => removeFile(file.id)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                      {file.status === 'uploading' && (
                        <span className="text-xs text-muted-foreground">
                          {file.progress}%
                        </span>
                      )}
                    </div>
                    {file.status === 'uploading' && (
                      <Progress value={file.progress} className="mt-2 h-1" />
                    )}
                    {file.errorMessage && (
                      <p className={`text-xs mt-1 ${file.status === 'error' ? 'text-red-600' : 'text-yellow-600'}`}>
                        {file.errorMessage}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}