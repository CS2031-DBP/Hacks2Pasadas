export interface AuthToken {
  sub: string;
  workspaceId: string;
  teamCode: string;
  role: "OPERATOR";
  email: string;
  displayName: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthToken;
    user: AuthToken;
  }
}
