import type { JwtPayload } from "jwt-decode";

export interface IJwtPayload extends JwtPayload {
    email: string
    name: string | undefined // twitchには無さそう
    nickname: string | undefined
    preferred_username: string | undefined
    picture: string | undefined
}