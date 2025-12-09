import { useState, useEffect } from "react"
import { ragService } from "@/lib/rag-service"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
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
  Settings,
  Bot,
  Languages,
  Database,
  Shield,
  Save,
  RotateCcw,
  TestTube,
  Lock,
  CheckCircle,
  XCircle
} from "lucide-react"
import { useTheme } from "./theme-provider"

interface AIModelConfig {
  id: string
  name: string
  description: string
  maxTokens: number
  available: boolean
}

export function SettingsSection() {
  const { toast } = useToast()
  const { setTheme } = useTheme()
  const [backendStatus, setBackendStatus] = useState({
    documentProcessor: false,
    ragBackend: false,
    configured: false
  })

  const defaultSettings = {
    // AI Model Settings
    selectedModel: "models/gemini-2.5-flash", // Modelo por defecto que funciona
    temperature: [0.7],
    maxResponseLength: [2048],
    topP: [0.9],
    presencePenalty: [0.1],

    // Language Settings
    responseLanguage: "es",
    autoDetectLanguage: true,

    // System Settings
    autoSave: true,
    enableNotifications: true,
    darkMode: "auto",

    // Security Settings
    encryptStorage: true,
    sessionTimeout: 30,

    // RAG Settings
    maxDocuments: 100,
    chunkSize: 512,
    overlapSize: 50,
    retrievalCount: 5,

    // Custom Prompt
    systemPrompt: "Eres un asistente experto que ayuda a responder preguntas basándose en documentos. Proporciona respuestas precisas y cita las fuentes relevantes."
  }

  const [settings, setSettings] = useState(defaultSettings)
  const [unsavedChanges, setUnsavedChanges] = useState(false)
  const [testDialogOpen, setTestDialogOpen] = useState(false)

  useEffect(() => {
    loadSettings()
    checkBackendStatus()
  }, [])

  const loadSettings = () => {
    try {
      const savedSettings = localStorage.getItem('rag-settings')
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings)

        // Migrar modelos legacy o deshabilitados al modelo por defecto
        const validModels = [
          'models/gemini-2.0-flash-exp',
          'models/gemini-2.5-flash'
        ]

        const needsMigration = !parsed.selectedModel || !validModels.includes(parsed.selectedModel)

        if (needsMigration) {
          console.warn(`⚠️ Migrating invalid model "${parsed.selectedModel}" to default model`)
          parsed.selectedModel = defaultSettings.selectedModel
          // Guardar la configuración migrada inmediatamente
          localStorage.setItem('rag-settings', JSON.stringify(parsed))
          toast({
            title: "⚠️ Modelo actualizado",
            description: `Modelo actualizado a ${defaultSettings.selectedModel}`,
            duration: 5000,
          })
        }

        setSettings(parsed)

        // Sincronizar el tema al cargar los settings
        const themeValue = parsed.darkMode === "auto" ? "system" : parsed.darkMode
        setTheme(themeValue as "light" | "dark" | "system")
      }
    } catch (error) {
      console.error('Error loading settings:', error)
    }
  }

  const checkBackendStatus = async () => {
    const health = await ragService.healthCheck()
    const config = ragService.checkConfiguration()
    setBackendStatus({
      documentProcessor: health.documentProcessor,
      ragBackend: health.ragBackend,
      configured: config.configured
    })
  }

  const aiModels: AIModelConfig[] = [
    {
      id: "models/gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      description: "✅ Modelo actual, equilibrio perfecto velocidad/calidad (recomendado)",
      maxTokens: 8192,
      available: true
    },
    {
      id: "models/gemini-2.0-flash-exp",
      name: "Gemini 2.0 Flash (Experimental)",
      description: "✅ Última generación, multimodal, funcionando",
      maxTokens: 8192,
      available: true
    }
  ]

  const updateSetting = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    console.log(`Setting updated: ${key} =`, value)

    // Cambiar tema en tiempo real cuando se selecciona (sin esperar a guardar)
    if (key === 'darkMode') {
      const themeValue = value === "auto" ? "system" : value
      setTheme(themeValue as "light" | "dark" | "system")
    }

    setUnsavedChanges(true)
  }

  const saveSettings = () => {
    console.log("Saving settings:", settings)
    try {
      localStorage.setItem('rag-settings', JSON.stringify(settings))

      // Sincronizar el tema con ThemeProvider
      // Mapear: "auto" → "system", "light" → "light", "dark" → "dark"
      const themeValue = settings.darkMode === "auto" ? "system" : settings.darkMode
      setTheme(themeValue as "light" | "dark" | "system")

      setUnsavedChanges(false)
      toast({
        title: "Configuración guardada",
        description: "Los cambios se han guardado correctamente",
      })
    } catch (error) {
      console.error("Error saving settings:", error)
      toast({
        title: "Error",
        description: "No se pudo guardar la configuración",
        variant: "destructive"
      })
    }
  }

  const resetSettings = () => {
    setSettings(defaultSettings)
    setUnsavedChanges(true)
    toast({
      title: "Configuración restablecida",
      description: "Los valores predeterminados han sido restaurados",
    })
  }

  const confirmTest = async () => {
    setTestDialogOpen(false)

    try {
      toast({
        title: "Probando configuración...",
        description: "Verificando conexión con el backend",
      })

      await checkBackendStatus()

      if (backendStatus.ragBackend) {
        await ragService.queryDocuments("Prueba de configuración")
        toast({
          title: "Prueba exitosa",
          description: "La configuración está funcionando correctamente",
        })
      } else {
        toast({
          title: "Error de conexión",
          description: "No se pudo conectar con el backend RAG",
          variant: "destructive"
        })
      }
    } catch (error) {
      console.error("Error testing model:", error)
      toast({
        title: "Error en la prueba",
        description: error instanceof Error ? error.message : "Error desconocido",
        variant: "destructive"
      })
    }
  }

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Configuración</h2>
          <p className="text-sm text-muted-foreground">
            Personaliza el comportamiento del sistema RAG
          </p>
        </div>
        <div className="flex gap-2">
          {unsavedChanges && (
            <Badge variant="secondary">Cambios sin guardar</Badge>
          )}
          <Button variant="outline" onClick={resetSettings}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Restablecer
          </Button>
          <Button onClick={saveSettings} disabled={!unsavedChanges}>
            <Save className="w-4 h-4 mr-2" />
            Guardar Cambios
          </Button>
        </div>
      </div>

      {/* Backend Status */}
      <Card className="mb-6 flex-shrink-0">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Estado del Backend:</span>
                {backendStatus.configured ? (
                  <Badge variant="default" className="gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Configurado
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <XCircle className="w-3 h-3" />
                    No configurado
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Document Processor:</span>
                {backendStatus.documentProcessor ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">RAG Backend:</span>
                {backendStatus.ragBackend ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600" />
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={checkBackendStatus}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Verificar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="ai-model" className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <TabsList className="grid w-full grid-cols-5 flex-shrink-0">
          <TabsTrigger value="ai-model">Modelo IA</TabsTrigger>
          <TabsTrigger value="language">Idioma</TabsTrigger>
          <TabsTrigger value="rag">RAG</TabsTrigger>
          <TabsTrigger value="system">Sistema</TabsTrigger>
          <TabsTrigger value="security">Seguridad</TabsTrigger>
        </TabsList>

        <TabsContent value="ai-model" className="space-y-6 flex-1 overflow-y-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                Configuración del Modelo de IA
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Model Selection */}
              <div className="space-y-3">
                <Label>Modelo de IA</Label>
                <Select value={settings.selectedModel} onValueChange={(value) => updateSetting('selectedModel', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {aiModels.map((model) => (
                      <SelectItem key={model.id} value={model.id} disabled={!model.available}>
                        <div className="flex items-center justify-between w-full">
                          <div>
                            <div className="font-medium">{model.name}</div>
                            <div className="text-xs text-muted-foreground">{model.description}</div>
                          </div>
                          {!model.available && (
                            <Badge variant="secondary">No disponible</Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Temperature */}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label>Creatividad (Temperature)</Label>
                  <span className="text-sm text-muted-foreground">{settings.temperature[0]}</span>
                </div>
                <Slider
                  value={settings.temperature}
                  onValueChange={(value) => updateSetting('temperature', value)}
                  max={1}
                  min={0}
                  step={0.1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  0 = Más determinista, 1 = Más creativo
                </p>
              </div>

              {/* Max Response Length */}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label>Longitud Máxima de Respuesta</Label>
                  <span className="text-sm text-muted-foreground">{settings.maxResponseLength[0]} tokens</span>
                </div>
                <Slider
                  value={settings.maxResponseLength}
                  onValueChange={(value) => updateSetting('maxResponseLength', value)}
                  max={4096}
                  min={256}
                  step={256}
                  className="w-full"
                />
              </div>

              {/* Advanced Parameters */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <Label>Top P</Label>
                    <span className="text-sm text-muted-foreground">{settings.topP[0]}</span>
                  </div>
                  <Slider
                    value={settings.topP}
                    onValueChange={(value) => updateSetting('topP', value)}
                    max={1}
                    min={0}
                    step={0.1}
                    className="w-full"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between">
                    <Label>Penalización de Presencia</Label>
                    <span className="text-sm text-muted-foreground">{settings.presencePenalty[0]}</span>
                  </div>
                  <Slider
                    value={settings.presencePenalty}
                    onValueChange={(value) => updateSetting('presencePenalty', value)}
                    max={2}
                    min={-2}
                    step={0.1}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Test Model */}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setTestDialogOpen(true)}>
                  <TestTube className="w-4 h-4 mr-2" />
                  Probar Configuración
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Custom System Prompt */}
          <Card>
            <CardHeader>
              <CardTitle>Prompt del Sistema</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Label>Instrucciones personalizadas para el asistente</Label>
                <Textarea
                  value={settings.systemPrompt}
                  onChange={(e) => updateSetting('systemPrompt', e.target.value)}
                  placeholder="Ingresa instrucciones personalizadas..."
                  className="min-h-24"
                />
                <p className="text-xs text-muted-foreground">
                  Estas instrucciones guiarán el comportamiento del asistente IA.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="language" className="space-y-6 flex-1 overflow-y-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Languages className="w-5 h-5" />
                Configuración de Idioma
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Idioma de respuestas</Label>
                <Select value={settings.responseLanguage} onValueChange={(value) => updateSetting('responseLanguage', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="pt">Português</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Detección automática de idioma</Label>
                  <p className="text-xs text-muted-foreground">
                    Detectar automáticamente el idioma de la pregunta
                  </p>
                </div>
                <Switch
                  checked={settings.autoDetectLanguage}
                  onCheckedChange={(checked) => updateSetting('autoDetectLanguage', checked)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rag" className="space-y-6 flex-1 overflow-y-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Configuración RAG
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label>Máximo de documentos</Label>
                  <span className="text-sm text-muted-foreground">{settings.maxDocuments}</span>
                </div>
                <Slider
                  value={[settings.maxDocuments]}
                  onValueChange={(value) => updateSetting('maxDocuments', value[0])}
                  max={500}
                  min={10}
                  step={10}
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <Label>Tamaño de fragmento</Label>
                    <span className="text-sm text-muted-foreground">{settings.chunkSize} chars</span>
                  </div>
                  <Slider
                    value={[settings.chunkSize]}
                    onValueChange={(value) => updateSetting('chunkSize', value[0])}
                    max={2048}
                    min={256}
                    step={256}
                    className="w-full"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between">
                    <Label>Superposición</Label>
                    <span className="text-sm text-muted-foreground">{settings.overlapSize} chars</span>
                  </div>
                  <Slider
                    value={[settings.overlapSize]}
                    onValueChange={(value) => updateSetting('overlapSize', value[0])}
                    max={512}
                    min={0}
                    step={25}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label>Fragmentos a recuperar</Label>
                  <span className="text-sm text-muted-foreground">{settings.retrievalCount}</span>
                </div>
                <Slider
                  value={[settings.retrievalCount]}
                  onValueChange={(value) => updateSetting('retrievalCount', value[0])}
                  max={20}
                  min={1}
                  step={1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Número de fragmentos relevantes a considerar para cada respuesta
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="space-y-6 flex-1 overflow-y-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Configuración del Sistema
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Guardado automático</Label>
                  <p className="text-xs text-muted-foreground">
                    Guardar conversaciones automáticamente
                  </p>
                </div>
                <Switch
                  checked={settings.autoSave}
                  onCheckedChange={(checked) => updateSetting('autoSave', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Notificaciones</Label>
                  <p className="text-xs text-muted-foreground">
                    Recibir notificaciones del sistema
                  </p>
                </div>
                <Switch
                  checked={settings.enableNotifications}
                  onCheckedChange={(checked) => updateSetting('enableNotifications', checked)}
                />
              </div>

              <div className="space-y-3">
                <Label>Tema de la interfaz</Label>
                <Select value={settings.darkMode} onValueChange={(value) => updateSetting('darkMode', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Claro</SelectItem>
                    <SelectItem value="dark">Oscuro</SelectItem>
                    <SelectItem value="auto">Automático</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6 flex-1 overflow-y-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Configuración de Seguridad
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Cifrado de almacenamiento</Label>
                  <p className="text-xs text-muted-foreground">
                    Cifrar datos locales y conversaciones
                  </p>
                </div>
                <Switch
                  checked={settings.encryptStorage}
                  onCheckedChange={(checked) => updateSetting('encryptStorage', checked)}
                />
              </div>

              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label>Timeout de sesión</Label>
                  <span className="text-sm text-muted-foreground">{settings.sessionTimeout} minutos</span>
                </div>
                <Slider
                  value={[settings.sessionTimeout]}
                  onValueChange={(value) => updateSetting('sessionTimeout', value[0])}
                  max={120}
                  min={5}
                  step={5}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  Tiempo antes de cerrar sesión automáticamente por inactividad
                </p>
              </div>

              <div className="p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Lock className="w-4 h-4" />
                  <span className="text-sm font-medium">Privacidad de Datos</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Los documentos y conversaciones se procesan de forma segura. Los datos nunca se comparten con terceros.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Test Configuration Dialog */}
      <AlertDialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Probar configuración del modelo</AlertDialogTitle>
            <AlertDialogDescription>
              Esto enviará una consulta de prueba al backend RAG para verificar que la configuración actual esté funcionando correctamente.
              <br /><br />
              <strong>Modelo seleccionado:</strong> {aiModels.find(m => m.id === settings.selectedModel)?.name}
              <br />
              <strong>Temperature:</strong> {settings.temperature[0]}
              <br />
              <strong>Max tokens:</strong> {settings.maxResponseLength[0]}
              <br /><br />
              ¿Deseas continuar con la prueba?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmTest}>
              <TestTube className="w-4 h-4 mr-2" />
              Probar ahora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}