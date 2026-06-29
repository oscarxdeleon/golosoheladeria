import { createFileRoute, useNavigate } from "@tanstack/react-router";
import logoAsset from "@/assets/logo-goloso.png.asset.json";

import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IceCream } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Ingreso · POS Heladería Goloso" },
      { name: "description", content: "Sistema POS para Heladería Goloso." },
    ],
  }),
  component: AuthPage,
});

const schema = z.object({
  email: z.string().trim().email("Correo inválido").max(255),
  password: z.string().min(6, "Mínimo 6 caracteres").max(72),
  full_name: z.string().trim().min(2, "Nombre requerido").max(80).optional(),
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace("/");
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password, full_name: mode === "signup" ? fullName : undefined });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Cuenta creada, ingresando…");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de autenticación");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/15 via-background to-accent/15 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <img src={logoAsset.url} alt="Heladería Goloso" className="mx-auto h-28 w-auto object-contain" />

          <CardTitle className="font-display text-2xl">Heladería Goloso</CardTitle>
          <CardDescription>Sistema POS · Acceso de empleados</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Iniciar sesión</TabsTrigger>
              <TabsTrigger value="signup">Crear cuenta</TabsTrigger>
            </TabsList>
            <form onSubmit={submit} className="mt-4 space-y-3">
              <TabsContent value="signup" className="space-y-3 mt-0">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Nombre completo</Label>
                  <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Tu nombre" />
                </div>
              </TabsContent>
              <div className="space-y-1.5">
                <Label htmlFor="email">Correo</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="empleado@goloso.com" autoComplete="email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Contraseña</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Procesando…" : mode === "signin" ? "Entrar" : "Crear cuenta"}
              </Button>
              {mode === "signup" && (
                <p className="text-xs text-muted-foreground text-center">
                  El primer usuario registrado será administrador.
                </p>
              )}
            </form>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
