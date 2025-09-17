import { useState } from "react";
import { User, Users, Network } from "lucide-react";
import { Team, AIAgent, RELATIONSHIP_TYPES } from "@/lib/types";
import { AgentStateInfo } from "../hooks/useAgentStates";
import AgentStateIndicator from "./AgentStateIndicator";
import MiniRelationshipNetwork from "./MiniRelationshipNetwork";

interface TeamMembersListProps {
  team: Team;
  agents: AIAgent[];
  agentStates: Map<string, AgentStateInfo>;
  timers: Map<string, number>;
  onAgentClick: (agentId: string) => void;
  isConnected?: boolean;
  useOriginalLayout?: boolean;
  onToggleLayout?: (useOriginal: boolean) => void;
}

export default function TeamMembersList({
  team,
  agents,
  agentStates,
  timers,
  onAgentClick,
  isConnected = true,
  useOriginalLayout = false,
  onToggleLayout,
}: TeamMembersListProps) {
  const [hoveredMember, setHoveredMember] = useState<string | null>(null);

  // Helper function to translate Korean role names to English
  const translateRole = (role: string): string => {
    const roleTranslations: Record<string, string> = {
      "아이디어 생성하기": "Idea Generation",
      "아이디어 평가하기": "Idea Evaluation",
      "피드백하기": "Feedback",
      "요청하기": "Request"
    };
    return roleTranslations[role] || role;
  };

  return (
    <div className="w-80 bg-white border-r border-gray-200 p-4 relative">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Team Members</h2>
        {!isConnected && (
          <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
            <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
            Reconnecting
          </div>
        )}
      </div>
      
      {/* Mini Relationship Network */}
      <div className="relative">
        <MiniRelationshipNetwork team={team} agents={agents} useOriginalLayout={useOriginalLayout} />
        {onToggleLayout && (
          <button
            onClick={() => onToggleLayout(!useOriginalLayout)}
            className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            title={useOriginalLayout ? "Switch to saved positions" : "Switch to circular layout"}
          >
            <Network className="h-3 w-3" />
            {useOriginalLayout ? "Saved Layout" : "Circular Layout"}
          </button>
        )}
      </div>
      
      <div className="space-y-2">
        {team.members.map((member, index) => {
          const agent = member.isUser
            ? null
            : agents.find((a) => a.id === member.agentId);
          const memberName = member.isUser
            ? "Me"
            : agent?.name || `Agent ${member.agentId}`;

          return (
            <div
              key={index}
              className={`flex items-center gap-2 p-2 rounded hover:bg-gray-50 ${
                member.agentId ? "cursor-pointer" : ""
              } relative`}
              onClick={() => {
                if (member.agentId) {
                  onAgentClick(member.agentId);
                }
              }}
              onMouseEnter={() => setHoveredMember(member.agentId || `user-${index}`)}
              onMouseLeave={() => setHoveredMember(null)}
            >
              <div className="flex-shrink-0">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center`}
                  style={{
                    backgroundColor: member.isUser ? "#00C85020" : "#2B7FFF20"
                  }}
                >
                  <User
                    className="h-3 w-3"
                    style={{
                      color: member.isUser ? "#00C850" : "#2B7FFF"
                    }}
                  />
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {memberName}
                  </span>
                </div>

                {/* Agent state display */}
                {!member.isUser && member.agentId && (
                  <div className="mt-1">
                    <AgentStateIndicator
                      state={agentStates.get(member.agentId)}
                      timer={timers.get(member.agentId)}
                      agentName={memberName}
                    />
                  </div>
                )}

                <div className="flex flex-wrap gap-1 mt-1">
                  {member.roles.map((role, roleIndex) => (
                    <span
                      key={roleIndex}
                      className="text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium"
                    >
                      {translateRole(role)}
                    </span>
                  ))}
                </div>

                {/* Demographics Tooltip */}
                {hoveredMember === (member.agentId || `user-${index}`) && agent && (
                  <div className="absolute left-full ml-2 top-0 z-50 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: "#2B7FFF20" }}
                      >
                        <User className="h-4 w-4" style={{ color: "#2B7FFF" }} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{agent.name}</h3>
                        <p className="text-xs text-gray-500">AI Agent Demographics</p>
                      </div>
                    </div>
                    
                    <div className="space-y-2 text-sm">
                      {agent.age && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Age:</span>
                          <span className="font-medium">{agent.age} years old</span>
                        </div>
                      )}
                      
                      {agent.gender && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Gender:</span>
                          <span className="font-medium">{agent.gender}</span>
                        </div>
                      )}
                      
                      {agent.education && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Education:</span>
                          <span className="font-medium">{agent.education}</span>
                        </div>
                      )}
                      
                      <div className="flex justify-between">
                        <span className="text-gray-600">Professional:</span>
                        <span className="font-medium">{agent.professional}</span>
                      </div>
                      
                      <div className="pt-2 border-t border-gray-100">
                        <div className="mb-2">
                          <span className="text-gray-600 text-xs font-medium">Skills:</span>
                          <p className="text-gray-800 text-xs mt-1">{agent.skills}</p>
                        </div>
                        
                        {agent.personality && (
                          <div className="mb-2">
                            <span className="text-gray-600 text-xs font-medium">Personality:</span>
                            <p className="text-gray-800 text-xs mt-1">{agent.personality}</p>
                          </div>
                        )}
                        
                        {agent.value && (
                          <div className="mb-2">
                            <span className="text-gray-600 text-xs font-medium">Values:</span>
                            <p className="text-gray-800 text-xs mt-1">{agent.value}</p>
                          </div>
                        )}
                        
                      </div>

                      {/* Relationships Section */}
                      <div className="pt-3 border-t border-gray-100">
                        <div className="flex items-center gap-1 mb-2">
                          <Users className="h-3 w-3 text-gray-500" />
                          <span className="text-gray-600 text-xs font-medium">
                            Team relationships from {agent.name}'s perspective
                          </span>
                        </div>
                        <div className="space-y-1">
                          {team.relationships && team.relationships.length > 0 ? (
                            (() => {
                              // Find all relationships involving this agent (both incoming and outgoing)
                              // Check both agent.id and agent.name, and also check for team member slot IDs
                              const currentMember = team.members.find(m => m.agentId === agent.id);
                              const memberSlotId = currentMember ? team.members.indexOf(currentMember).toString() : null;
                              
                              const agentRelationships = team.relationships.filter(rel => {
                                // Check if this agent is involved in the relationship
                                const isFromAgent = rel.from === agent.id || rel.from === agent.name || 
                                                  rel.from === memberSlotId || rel.from === `${agent.name}봇`;
                                const isToAgent = rel.to === agent.id || rel.to === agent.name || 
                                                rel.to === memberSlotId || rel.to === `${agent.name}봇`;
                                // Filter out null relationships from UI display  
                                return (isFromAgent || isToAgent) && rel.type;
                              });
                              
                              if (agentRelationships.length === 0) {
                                return (
                                  <div className="text-xs text-gray-400 italic py-1">
                                    No relationships established with other team members
                                  </div>
                                );
                              }
                              
                              return agentRelationships.map((relationship, relIndex) => {
                                // Determine if this agent is the "from" or "to" in the relationship
                                const isFromAgent = relationship.from === agent.id || relationship.from === agent.name ||
                                                  relationship.from === memberSlotId || relationship.from === `${agent.name}봇`;
                                const otherPersonId = isFromAgent ? relationship.to : relationship.from;
                                
                                // Find the other person's info
                                let otherPersonName = otherPersonId;
                                if (otherPersonId === "Me") {
                                  otherPersonName = "Me";
                                } else {
                                  // Check if it's an agent name ending with "봇"
                                  if (otherPersonId.endsWith("봇")) {
                                    const baseAgentName = otherPersonId.slice(0, -1); // Remove "봇" suffix
                                    const otherAgent = agents.find(a => a.name === baseAgentName);
                                    if (otherAgent) {
                                      otherPersonName = otherAgent.name;
                                    }
                                  } else {
                                    const otherAgent = agents.find(a => a.id === otherPersonId || a.name === otherPersonId);
                                    if (otherAgent) {
                                      otherPersonName = otherAgent.name;
                                    }
                                  }
                                }
                                
                                const relationshipInfo = RELATIONSHIP_TYPES[relationship.type];
                                
                                // Create relationship description
                                const relationshipText = otherPersonName;
                                
                                // Determine indicator based on relationship type
                                let indicator = "";
                                if (relationship.type === "SUPERVISOR") {
                                  indicator = isFromAgent ? "→" : "←";
                                } else {
                                  indicator = "—"; // horizontal bar for friends/awkward relationships
                                }
                                
                                return (
                                  <div key={relIndex} className="flex items-center justify-between text-xs py-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-gray-700 font-medium">
                                        {indicator} {relationshipText}
                                      </span>
                                    </div>
                                    <span 
                                      className="px-2 py-0.5 rounded text-xs font-medium flex-shrink-0"
                                      style={{ 
                                        backgroundColor: `${relationshipInfo.color}20`,
                                        color: relationshipInfo.color 
                                      }}
                                    >
                                      {relationshipInfo.label}
                                    </span>
                                  </div>
                                );
                              });
                            })()
                          ) : (
                            <div className="text-xs text-gray-400 italic py-1">
                              <p className="mb-1">No team relationships established</p>
                              <p className="text-xs text-gray-300">
                                You can define relationships between team members<br />
                                during the relationship setup step when creating a new team
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
