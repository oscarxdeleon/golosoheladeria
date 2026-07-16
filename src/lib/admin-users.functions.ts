import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireLovableCloudAuth } from "@/lib/lovable-cloud-auth";

const ROLE = z.enum(["admin", "cajero", "mesero", "domiciliario", "supervisor"]);

function friendlyUserError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/Missing Supabase environment variable|SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SERVICE_ROLE_KEY/i.test(message)) {
    return new Error("No se pudo completar la operación por configuración del backend. Ya se ajustó el flujo para no depender de esa configuración; recarga e intenta de nuevo.");
  }
  if (/duplicate key|already registered|already exists|Ya existe/i.test(message)) {
    return new Error("Ya existe un usuario con ese correo.");
  }
  return new Error(message || fallback);
}

type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([requireLovableCloudAuth])
  .inputValidator((data) =>
    z.object({
      email: z.string().trim().email(),
      password: z.string().min(6, "Mínimo 6 caracteres"),
      full_name: z.string().trim().min(2),
      role: ROLE,
      branch_id: z.string().uuid().nullable().optional(),
    }).parse(data),
  )
  .handler(async ({ context, data }) => {
    try {
      const rpc = context.supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => RpcResult<string>;
      const { data: newId, error } = await rpc("admin_create_app_user", {
        _email: data.email,
        _password: data.password,
        _full_name: data.full_name,
        _role: data.role,
        _branch_id: data.branch_id ?? null,
        _active: true,
      });
      if (error) throw new Error(error.message);
      if (!newId) throw new Error("No se pudo crear el usuario");
      return { id: newId };
    } catch (error) {
      throw friendlyUserError(error, "No se pudo crear el usuario");
    }
  });

export const updateAppUser = createServerFn({ method: "POST" })
  .middleware([requireLovableCloudAuth])
  .inputValidator((data) =>
    z.object({
      user_id: z.string().uuid(),
      full_name: z.string().trim().min(2).optional(),
      role: ROLE.optional(),
      branch_id: z.string().uuid().nullable().optional(),
      active: z.boolean().optional(),
      password: z.string().min(6).optional(),
    }).parse(data),
  )
  .handler(async ({ context, data }) => {
    // Uses SECURITY DEFINER RPC so no service-role key is required at runtime.
    try {
      const branchIdSet = Object.prototype.hasOwnProperty.call(data, "branch_id");
      const { error } = await context.supabase.rpc("admin_update_app_user", {
        _user_id: data.user_id,
        _full_name: data.full_name ?? undefined,
        _role: data.role ?? undefined,
        _branch_id: branchIdSet ? ((data.branch_id ?? null) as unknown as string) : undefined,
        _branch_id_set: branchIdSet,
        _active: data.active ?? undefined,
        _password: data.password ?? undefined,
      });
      if (error) throw new Error(error.message);
      return { ok: true };
    } catch (error) {
      throw friendlyUserError(error, "No se pudo actualizar el usuario");
    }
  });

export const deleteAppUser = createServerFn({ method: "POST" })
  .middleware([requireLovableCloudAuth])
  .inputValidator((data) => z.object({ user_id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    if (data.user_id === context.userId) throw new Error("No puedes eliminar tu propio usuario");
    // Uses SECURITY DEFINER RPC so no service-role key is required at runtime.
    try {
      const { error } = await context.supabase.rpc("admin_delete_app_user", { _user_id: data.user_id });
      if (error) throw new Error(error.message);
      return { ok: true };
    } catch (error) {
      throw friendlyUserError(error, "No se pudo eliminar el usuario");
    }
  });

