import { createClient } from "@supabase/supabase-js";

// Используется ТОЛЬКО публичный anon-ключ. Он безопасен для фронта,
// т.к. все права доступа закрыты RLS-политиками на стороне базы.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Скопируйте .env.example в .env и заполните значения.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
