import { clearSession } from "../../../chatgpt-auth";
export async function GET(request:Request){await clearSession();return Response.redirect(new URL("/signin",request.url),303)}
