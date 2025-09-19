"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Send, MessageCircle } from "lucide-react";

interface FeedbackTabData {
  id: string;
  name: string;
  participantId: string;
  participantName: string;
  type: "user_to_ai" | "ai_to_user";
  sessionData?: any;
  isActive: boolean;
}

interface FeedbackMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
  type: string;
}

interface FeedbackTabContentProps {
  tab: FeedbackTabData;
  teamId: string;
  onClose: () => void;
}

export default function FeedbackTabContent({
  tab,
  teamId,
  onClose,
}: FeedbackTabContentProps) {
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize textarea with max 4 lines
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to calculate scrollHeight correctly
      textarea.style.height = 'auto';
      
      // Calculate the height needed for the content
      const scrollHeight = textarea.scrollHeight;
      const lineHeight = 20; // Approximate line height in pixels
      const maxLines = 4;
      const minHeight = lineHeight * 1.2; // Minimum height for 1 line
      const maxHeight = lineHeight * maxLines;
      
      // Set height based on content, but constrained by min/max
      const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
      textarea.style.height = `${newHeight}px`;
    }
  }, []);

  // Adjust height whenever newMessage changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [newMessage, adjustTextareaHeight]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Load messages
  const loadMessages = async () => {
    try {
      const response = await fetch(
        `/api/teams/${teamId}/feedback-sessions?sessionId=${tab.id}`
      );

      if (response.ok) {
        const result = await response.json();
        
        if (result.session?.messages) {
          // Filter only actual conversation messages
          const chatMessages = result.session.messages
            .filter((msg: any) => msg.type === "message")
            .map((msg: any) => {
              return {
                id: msg.id,
                sender: msg.sender,
                content: msg.content,
                timestamp: msg.timestamp,
                type: msg.type,
              };
            });

          // Update state only if message count changed
          if (chatMessages.length !== lastMessageCountRef.current) {
            setMessages(chatMessages);
            lastMessageCountRef.current = chatMessages.length;

            // Disable generation state if AI response was added
            if (chatMessages.length > 0) {
              const lastMessage = chatMessages[chatMessages.length - 1];
              if (lastMessage.sender !== "Me") {
                setIsGenerating(false);
              }
            }
          }

          // Check session end
          if (
            result.session.status === "completed" ||
            result.session.status === "ended"
          ) {
            setSessionEnded(true);
            setIsGenerating(false);
            
            // Add end message
            const endMessage: FeedbackMessage = {
              id: `end-${Date.now()}`,
              sender: "System",
              content: "The feedback session has ended.",
              timestamp: new Date().toISOString(),
              type: "system",
            };
            setMessages(prev => [...prev, endMessage]);
            
            // Auto-close tab if AI ended session
            if (result.session.endedBy === "ai") {
              console.log("AI ended the feedback session. Closing tab.");
              setTimeout(() => {
                onClose();
              }, 2000); // Close tab 2 seconds after showing end message
            }
          }
        }
      }
    } catch (error) {
      // Handle message load failure
    }
  };

  // Initial message setup
  useEffect(() => {
    if (tab.sessionData?.message && tab.type === "user_to_ai") {
      const initialMessage: FeedbackMessage = {
        id: "initial",
        sender: "Me",
        content: tab.sessionData.message,
        timestamp: new Date().toISOString(),
        type: "message",
      };
      
      
      setMessages([initialMessage]);
      lastMessageCountRef.current = 1;
    }

    // Initial load
    loadMessages();
  }, [tab.id]);

  // Polling (every 3 seconds)
  useEffect(() => {
    if (sessionEnded) return;

    const interval = setInterval(loadMessages, 3000);
    return () => clearInterval(interval);
  }, [sessionEnded, tab.id, teamId]);

  // Scroll
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || sessionEnded || isLoading) return;

    const userMessage: FeedbackMessage = {
      id: `temp-${Date.now()}`,
      sender: "Me",
      content: newMessage.trim(),
      timestamp: new Date().toISOString(),
      type: "message",
    };


    // Immediate UI update
    setMessages((prev) => [...prev, userMessage]);
    setNewMessage("");
    setIsLoading(true);
    setIsGenerating(true);

    try {
      const requestBody = {
        action: "send_message",
        sessionId: tab.id,
        message: userMessage.content,
        senderId: "Me",
      };
      
      
      const response = await fetch(`/api/teams/${teamId}/feedback-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        // Reload messages after 1 second
        setTimeout(loadMessages, 1000);
      } else {
        const errorText = await response.text();
        console.error("Message send failed:", {
          status: response.status,
          error: errorText,
        });
        // Remove message on failure
        setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
        setIsGenerating(false);
      }
    } catch (error) {
      console.error("Message send error:", error);
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      setIsGenerating(false);
    } finally {
      setIsLoading(false);
    }
  };

  // End session
  const handleEndSession = async () => {
    try {
      await fetch(`/api/teams/${teamId}/feedback-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "end",
          sessionId: tab.id,
          endedBy: "user",
        }),
      });
    } catch (error) {
      console.error("Session end failed:", error);
    }

    onClose();
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="p-4 bg-orange-50 border-b border-orange-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-orange-600" />
            <div>
              <h3 className="font-semibold text-orange-800">
                Feedback Session with {tab.participantName}
              </h3>
              <p className="text-xs text-orange-600">
                {tab.type === "user_to_ai"
                  ? `Requested feedback from ${tab.participantName}.`
                  : `${tab.participantName} requested feedback.`}
              </p>
            </div>
          </div>
          <Button
            onClick={handleEndSession}
            variant="outline"
            size="sm"
            className="text-orange-600 border-orange-300 hover:bg-orange-100"
            disabled={sessionEnded}
          >
            End Feedback
          </Button>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => {
          
          const isMyMessage = message.sender === "Me";
          const isSystemMessage = message.sender === "System";

          if (isSystemMessage) {
            return (
              <div
                key={`${message.id}-${message.timestamp}`}
                className="flex justify-center mb-4"
              >
                <div className="bg-gray-100 text-gray-600 text-sm px-4 py-2 rounded-full">
                  {message.content}
                </div>
              </div>
            );
          }

          return (
            <div
              key={`${message.id}-${message.timestamp}`}
              className={`flex ${
                isMyMessage ? "justify-end" : "justify-start"
              }`}
            >
              <div className="max-w-md">
                {!isMyMessage && (
                  <div className="text-xs text-gray-500 mb-1 px-3">
                    {tab.participantName} •{" "}
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </div>
                )}

                <div
                  className={`rounded-2xl px-4 py-3 ${
                    isMyMessage
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 text-gray-900"
                  }`}
                >
                  <p className="text-sm leading-relaxed">{message.content}</p>
                </div>

                {isMyMessage && (
                  <div className="text-xs text-gray-500 mt-1 px-3 text-right">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* AI generation spinner */}
        {isGenerating && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-3">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.1s" }}
                ></div>
                <div
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                ></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={
              sessionEnded ? "Session has ended." : "Enter your message..."
            }
            disabled={isLoading || sessionEnded}
            className="flex-1 min-h-[40px] max-h-[80px] resize-none overflow-y-auto focus:ring-orange-500"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!newMessage.trim() || isLoading || sessionEnded}
            className="px-6 bg-orange-500 hover:bg-orange-600 text-white"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
