import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let database:ReturnType<typeof drizzle<typeof schema>>|null=null;
export function getDb(){
  if(database)return database;
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("DATABASE_URL is not configured.");
  database=drizzle(neon(url),{schema});
  return database;
}
