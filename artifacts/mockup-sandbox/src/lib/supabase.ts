import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://kotbcwrvgekmyzovejqv.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdGJjd3J2Z2VrbXl6b3ZlanF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODQ5MzcsImV4cCI6MjA5NDQ2MDkzN30.86mv05ykNWQajZGA4_3YvKbmgKxr42P8BMdGMPqUrPQ";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);