import { compare,hash } from "bcryptjs";
import { eq,sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { users } from "../../../db/schema";
import { createSession } from "../../chatgpt-auth";

const clean=(value:unknown)=>String(value??"").trim();
const fail=(error:string,status=400)=>Response.json({error},{status});
export async function POST(request:Request){
  const body=await request.json() as Record<string,unknown>;const action=clean(body.action);const email=clean(body.email).toLowerCase();const password=clean(body.password);if(!email||!email.includes("@")||password.length<8)return fail("Enter a valid email and a password of at least 8 characters.");const db=getDb();
  if(action==="register"){
    if(!process.env.TEAM_SIGNUP_CODE||clean(body.signupCode)!==process.env.TEAM_SIGNUP_CODE)return fail("The team signup code is incorrect.",403);
    const name=clean(body.name);if(!name)return fail("Enter your full name.");if((await db.select({id:users.id}).from(users).where(eq(users.email,email)).limit(1)).length)return fail("An account with this email already exists.",409);
    const [{total}]=await db.select({total:sql<number>`count(*)`}).from(users);const [user]=await db.insert(users).values({authUserId:crypto.randomUUID(),email,name,passwordHash:await hash(password,12),role:Number(total)===0?"Administrator":"Field Executive"}).returning();await createSession(user);return Response.json({ok:true,role:user.role});
  }
  if(action==="login"){
    const [user]=await db.select().from(users).where(eq(users.email,email)).limit(1);if(!user||!user.passwordHash||!(await compare(password,user.passwordHash)))return fail("Email or password is incorrect.",401);if(user.status!=="Active")return fail("This account is inactive.",403);await createSession(user);return Response.json({ok:true,role:user.role});
  }
  return fail("Unknown authentication action.");
}
