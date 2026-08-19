import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

export type ChatGPTUser={userId:string;displayName:string;email:string;fullName:string|null};
const COOKIE="reportflow_session";
const secret=()=>new TextEncoder().encode(process.env.AUTH_SECRET||"");

export async function getChatGPTUser():Promise<ChatGPTUser|null>{
  const token=(await cookies()).get(COOKIE)?.value;if(!token||!process.env.AUTH_SECRET)return null;
  try{const {payload}=await jwtVerify(token,secret());const email=String(payload.email||"");const userId=String(payload.sub||"");const fullName=payload.name?String(payload.name):null;if(!email||!userId)return null;return{userId,email,fullName,displayName:fullName||email}}
  catch{return null}
}
export async function createSession(user:{authUserId:string;email:string;name:string}){
  if(!process.env.AUTH_SECRET)throw new Error("AUTH_SECRET is not configured.");
  const token=await new SignJWT({email:user.email,name:user.name}).setProtectedHeader({alg:"HS256"}).setSubject(user.authUserId).setIssuedAt().setExpirationTime("7d").sign(secret());
  (await cookies()).set(COOKIE,token,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:60*60*24*7});
}
export async function clearSession(){(await cookies()).set(COOKIE,"",{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:0})}
