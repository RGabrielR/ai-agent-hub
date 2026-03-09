# Estructura de Agentes

Esta carpeta contiene los diferentes agentes AI disponibles en la plataforma.

## Estructura

```
/src/agents/
├── chatrag/          # Agente ChatRag (RAG conversacional)
│   └── index.tsx
└── README.md
```

## Agregar un Nuevo Agente

1. Crear una carpeta con el nombre del agente en `/src/agents/`
2. Crear un archivo `index.tsx` con el componente principal
3. Agregar la ruta en `src/App.tsx`
4. Actualizar la lista de agentes en `src/pages/agents-showcase.tsx`

## Rutas

- `/` - Showcase de agentes (página principal)
- `/agents/chatrag` - ChatRag Agent
