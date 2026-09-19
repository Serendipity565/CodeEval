import { apiRequest } from "./client";
import type { AuthState, User } from "../types";

type AuthResponse = { accessToken: string; user: User };
const toAuthState = (data: AuthResponse): AuthState => ({
  token: data.accessToken,
  user: data.user,
});

export async function login(username: string, password: string): Promise<AuthState> {
  return toAuthState(await apiRequest<AuthResponse>("/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  }));
}

export async function register(input: {
  username: string;
  displayName: string;
  password: string;
  role: User["role"];
}): Promise<AuthState> {
  return toAuthState(await apiRequest<AuthResponse>("/auth/register", "", {
    method: "POST",
    body: JSON.stringify(input),
  }));
}
