import { useState } from "react"
import { useNavigate } from "react-router-dom"

interface Agent {
  id: string
  name: string
  description: string
  url: string
  accentColor: string
  openInNewTab: boolean
}

const agents: Agent[] = [
  {
    id: "chatrag",
    name: "ChatRag",
    description: "IA conversacional potenciada por generación aumentada de recuperación para interacciones inteligentes con documentos.",
    url: "/agents/chatrag",
    accentColor: "from-cyan-400 to-blue-500",
    openInNewTab: false,
  },
]

export default function AgentsShowcase() {
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleAgentClick = (agent: Agent) => {
    if (agent.openInNewTab) {
      window.open(agent.url, '_blank', 'noopener,noreferrer')
    } else {
      navigate(agent.url)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0b0f19] via-[#12152a] to-[#1a103f] relative overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-15">
        <img
          src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ChatGPT%20Image%2015%20oct%202025%2C%2011_51_09%20a.m.-3gObjWqtt3OofzxXrWNA5hxAlXVuYU.png"
          alt="AI Robots Background"
          className="w-full h-full object-cover animate-float"
        />
      </div>

      {/* Ambient glow effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[120px] animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-cyan-600/20 rounded-full blur-[120px] animate-pulse animation-delay-1000" />

      {/* Main content */}
      <div className="relative z-10 flex items-start justify-center min-h-screen px-8 pt-20 pb-20">
        <div className="w-full max-w-6xl mx-auto">
          {/* Main Title */}
          <div className="text-center pb-4 ">
            <h1 className="cursor-default text-5xl lg:text-6xl font-bold bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent tracking-tight pb-4">
              Fábrica de Agentes AI
            </h1>
          </div>

          {/* Subtitle with modern border */}
          <div className="text-center mb-12">
            <div className="relative inline-block">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-xl blur-sm" />
              <p className="cursor-default relative text-gray-300 text-lg px-8 py-3 border border-purple-500/30 rounded-xl backdrop-blur-sm bg-white/5">
                Pasa el cursor sobre cada agente para conocer más
              </p>
            </div>
          </div>

          <div className="flex flex-nowrap justify-center items-start gap-4 lg:gap-8">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="relative group w-52 flex-shrink-0"
              >
                {/* Agent name - always visible */}
                <div
                  className="text-center mb-6 cursor-default"
                  onMouseEnter={() => setHoveredAgent(agent.id)}
                  onMouseLeave={() => setHoveredAgent(null)}
                >
                  <h2 className=" text-2xl lg:text-3xl font-bold text-white tracking-tight transition-all duration-300 group-hover:scale-110 cursor-default">
                    {agent.name}
                  </h2>
                  <div
                    className={`h-1 w-0 mx-auto mt-2 bg-gradient-to-r ${agent.accentColor} transition-all duration-300 group-hover:w-full rounded-full`}
                  />
                </div>

                {/* Bridge area - invisible connector between title and card */}
                <div
                  className="absolute top-full left-0 right-0 h-8 -mt-2"
                  onMouseEnter={() => setHoveredAgent(agent.id)}
                  onMouseLeave={() => setHoveredAgent(null)}
                />

                {/* Hover card */}
                <div
                  onMouseEnter={() => setHoveredAgent(agent.id)}
                  onMouseLeave={() => setHoveredAgent(null)}
                  className={`cursor-default absolute top-full left-1/2 -translate-x-1/2 mt-2 w-80 transition-all duration-300 ${
                    hoveredAgent === agent.id ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none"
                  }`}
                >
                  <div className="relative">
                    {/* Glow effect */}
                    <div
                      className={`absolute inset-0 bg-gradient-to-r ${agent.accentColor} opacity-20 blur-xl rounded-2xl`}
                    />

                    {/* Card content */}
                    <div className="relative bg-white/10 backdrop-blur-xl rounded-2xl border border-purple-500/30 p-6 shadow-2xl shadow-purple-900/50">
                      {/* Title */}
                      <h3
                        className={`text-2xl font-bold mb-3 bg-gradient-to-r ${agent.accentColor} bg-clip-text text-transparent`}
                      >
                        {agent.name}
                      </h3>

                      {/* Description */}
                      <p className="text-gray-300 text-sm leading-relaxed mb-6">{agent.description}</p>

                      {/* CTA Button */}
                      <button
                        onClick={() => handleAgentClick(agent)}
                        className={`block w-full text-center py-3 px-6 rounded-xl bg-gradient-to-r ${agent.accentColor} text-white font-semibold transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-purple-500/50 cursor-pointer`}
                      >
                        Abrir agente
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>


        </div>
      </div>
    </div>
  )
}
