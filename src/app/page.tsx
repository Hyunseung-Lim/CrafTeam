"use client";

import { useState, useEffect } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { getUserTeamsAction } from "@/actions/team.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Team } from "@/lib/types";
import { Users, Plus, LogOut, LogIn } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Auth form states (for landing page)
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Dashboard states (simplified)
  const [teams, setTeams] = useState<Team[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);

  // Load user data when logged in
  useEffect(() => {
    if (session) {
      async function loadData() {
        setIsDataLoading(true);
        try {
          const userTeams = await getUserTeamsAction();
          setTeams(userTeams);
        } catch (error) {
          console.error("Data loading error:", error);
        } finally {
          setIsDataLoading(false);
        }
      }
      loadData();
    }
  }, [session]);

  // Login handler for landing page
  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAuthLoading(true);
    setAuthError(null);

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
      const result = await signIn("credentials", {
        email,
        password,
        isSignUp: "false",
        redirect: false,
      });

      if (result?.error) {
        setAuthError("Email or password is incorrect.");
      }
    } catch (error) {
      setAuthError("An error occurred during login.");
    } finally {
      setIsAuthLoading(false);
    }
  }


  // Loading state
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Landing page for non-logged-in users
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">CrafTeam</CardTitle>
            <CardDescription>
              Login to access your AI teams
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="your@email.com"
                  required
                  disabled={isAuthLoading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="••••••••"
                  required
                  disabled={isAuthLoading}
                />
              </div>
              {authError && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                  {authError}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isAuthLoading}>
                <LogIn className="h-4 w-4 mr-2" />
                {isAuthLoading ? "Logging in..." : "Login"}
              </Button>
            </form>
            <div className="mt-6 text-center text-sm">
              <span className="text-gray-600">Don't have an account? </span>
              <Link
                href="/signup"
                className="font-semibold text-blue-600 hover:underline"
              >
                Sign up
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Dashboard for logged-in users
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-bold text-gray-900">CrafTeam</h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm font-semibold text-gray-800">
                {session?.user?.name || session?.user?.email || "User"}
              </span>
              <Button variant="ghost" size="sm" onClick={() => signOut()}>
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 pt-12 pb-6">
        {isDataLoading ? (
          <div className="space-y-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-3 h-3 bg-gray-300 rounded-full animate-pulse"></div>
                <div className="h-6 w-32 bg-gray-300 rounded animate-pulse"></div>
              </div>
              <Card className="bg-gradient-to-br from-gray-50 to-gray-100">
                <CardContent className="p-8">
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex-1">
                      <div className="h-8 w-48 bg-gray-300 rounded animate-pulse mb-4"></div>
                      <div className="flex items-center gap-4">
                        <div className="h-4 w-24 bg-gray-300 rounded animate-pulse"></div>
                        <div className="h-4 w-32 bg-gray-300 rounded animate-pulse"></div>
                      </div>
                    </div>
                    <div className="flex flex-row gap-3">
                      <div className="h-12 w-32 bg-gray-300 rounded animate-pulse"></div>
                      <div className="h-12 w-40 bg-gray-300 rounded animate-pulse"></div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : teams && teams.length > 0 ? (
          <div className="space-y-8">
            {/* Current active team */}
            {(() => {
              const sortedTeams = [...(teams || [])].sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              );
              const currentTeam = sortedTeams[0];

              return (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                      <h3 className="text-lg font-semibold text-gray-900">Current Active Team</h3>
                    </div>
                    <Link href="/dashboard/teams/new">
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />Create New Team
                      </Button>
                    </Link>
                  </div>

                  <Card className="bg-gradient-to-br from-blue-50 to-indigo-50">
                    <CardContent className="p-8">
                      <div className="flex items-start justify-between mb-6">
                        <div>
                          <h3 className="text-2xl font-bold text-gray-900 mb-2">
                            {currentTeam.teamName}
                          </h3>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            <div className="flex items-center gap-2">
                              <Users className="h-4 w-4" />
                              <span>{(currentTeam?.members || []).length} members</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span>
                                Created: {new Date(currentTeam.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            {currentTeam.topic && (
                              <div className="flex items-center gap-2">
                                <span className="text-lg">💡</span>
                                <span>Topic: {currentTeam.topic}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-3">
                          <Link href={`/ideation/${currentTeam.id}`}>
                            <Button
                              size="lg"
                              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg w-full"
                            >
                              <span className="text-lg mr-2">💡</span>
                              <span className="text-base font-bold">Start Ideation</span>
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })()}

            {/* Team history */}
            {teams && teams.length > 1 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Team History</h3>
                <div className="space-y-3">
                  {(() => {
                    const sortedTeams = [...(teams || [])].sort(
                      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    );
                    return sortedTeams.slice(1).map((team, index) => (
                      <Card
                        key={team.id}
                        className="bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                              <div>
                                <h4 className="font-medium text-gray-900">{team.teamName}</h4>
                                <p className="text-sm text-gray-600">
                                  {(team.members || []).length} members •{" "}
                                  {new Date(team.createdAt).toLocaleDateString()}
                                  {team.topic && ` • Topic: ${team.topic}`}
                                </p>
                              </div>
                            </div>
                            <Link href={`/ideation/${team.id}`}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-gray-500 hover:text-gray-700"
                              >
                                Start Ideation
                              </Button>
                            </Link>
                          </div>
                        </CardContent>
                      </Card>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        ) : (
          <Card>
            <CardContent className="text-center py-16">
              <div className="max-w-md mx-auto">
                <Users className="mx-auto h-16 w-16 text-gray-400 mb-6" />
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  Create your first team
                </h3>
                <p className="text-gray-600 mb-6">
                  Build teams with AI members and start creative ideation.
                </p>
                <Link href="/dashboard/teams/new">
                  <Button
                    size="lg"
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    <Plus className="h-4 w-4 mr-2" />Create First Team
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

    </div>
  );
}