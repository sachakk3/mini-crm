import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import type { Profile } from "../lib/types";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Текст ошибки, если профиль текущего пользователя не удалось загрузить */
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = async (userId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.error("Ошибка загрузки профиля:", error.message);
      setProfileError(error.message);
    } else if (!data) {
      setProfileError(
        "Профиль текущего пользователя не найден в таблице profiles.",
      );
    } else {
      setProfileError(null);
    }
    setProfile((data as Profile) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    // INITIAL_SESSION приходит после того, как supabase-js восстановил
    // сессию из localStorage и при необходимости обновил токен — поэтому
    // запрос профиля не уходит с просроченным access token (в отличие
    // от немедленного getSession() при перезагрузке страницы).
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        if (newSession) void loadProfile(newSession.user.id);
        else {
          setProfile(null);
          setProfileError(null);
          setLoading(false);
        }
      },
    );

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (
    email: string,
    password: string,
  ): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return error ? error.message : null;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, profileError, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx)
    throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
