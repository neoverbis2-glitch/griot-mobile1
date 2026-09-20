import { supabase } from "@/integrations/supabase/client";

export interface GcuWalletState {
  balance: number;
  tier: string;
  handle: string;
  totalSpent: number;
}

const GCU_STORAGE_BALANCE_KEY = "griot_gcu_balance_v1";
const GCU_STORAGE_TIER_KEY = "griot_gcu_tier_v1";
const FREE_TIER_INITIAL_GCU = 100;

/**
 * Lê o saldo atual de GCU da carteira (com fallback persistente em localStorage)
 */
export function getLocalGcuBalance(): number {
  if (typeof window === "undefined") return FREE_TIER_INITIAL_GCU;
  const stored = localStorage.getItem(GCU_STORAGE_BALANCE_KEY);
  if (stored === null) {
    localStorage.setItem(GCU_STORAGE_BALANCE_KEY, String(FREE_TIER_INITIAL_GCU));
    return FREE_TIER_INITIAL_GCU;
  }
  const val = Number(stored);
  return Number.isFinite(val) ? val : FREE_TIER_INITIAL_GCU;
}

export function getLocalGcuTier(): string {
  if (typeof window === "undefined") return "free";
  return localStorage.getItem(GCU_STORAGE_TIER_KEY) || "free";
}

/**
 * Carrega a carteira do utilizador de forma sincronizada (Supabase + localStorage)
 */
export async function fetchUserGcuWallet(userId?: string): Promise<GcuWalletState> {
  const localBalance = getLocalGcuBalance();
  const localTier = getLocalGcuTier();

  if (!userId || userId === "anonymous") {
    return {
      balance: localBalance,
      tier: localTier,
      handle: "@local",
      totalSpent: Math.max(0, FREE_TIER_INITIAL_GCU - localBalance),
    };
  }

  try {
    const { data: wallet, error } = await supabase
      .from("wallets")
      .select("balance_gcu, tier, handle")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !wallet) {
      // Se não existe carteira no Supabase, cria carteira inicial com 100 GCU no plano free
      const { data: created } = await supabase
        .from("wallets")
        .insert({
          user_id: userId,
          balance_gcu: localBalance,
          tier: localTier,
          handle: `@user_${userId.slice(0, 6)}`,
        })
        .select("balance_gcu, tier, handle")
        .maybeSingle();

      const bal = Number(created?.balance_gcu ?? localBalance);
      const tier = String(created?.tier ?? localTier).toLowerCase();
      if (typeof window !== "undefined") {
        localStorage.setItem(GCU_STORAGE_BALANCE_KEY, String(bal));
        localStorage.setItem(GCU_STORAGE_TIER_KEY, tier);
      }
      return {
        balance: bal,
        tier,
        handle: created?.handle ?? "@griot",
        totalSpent: Math.max(0, FREE_TIER_INITIAL_GCU - bal),
      };
    }

    const remoteBalance = Number(wallet.balance_gcu ?? 100);
    const remoteTier = String(wallet.tier ?? "free").toLowerCase();

    // Mantém local sincronizado
    if (typeof window !== "undefined") {
      localStorage.setItem(GCU_STORAGE_BALANCE_KEY, String(remoteBalance));
      localStorage.setItem(GCU_STORAGE_TIER_KEY, remoteTier);
    }

    return {
      balance: remoteBalance,
      tier: remoteTier,
      handle: wallet.handle || "@griot",
      totalSpent: Math.max(0, FREE_TIER_INITIAL_GCU - remoteBalance),
    };
  } catch {
    return {
      balance: localBalance,
      tier: localTier,
      handle: "@griot",
      totalSpent: Math.max(0, FREE_TIER_INITIAL_GCU - localBalance),
    };
  }
}

/**
 * Valida se o utilizador tem GCU suficiente para realizar uma execução.
 * No plano free, se o saldo chegar a 0 (ou uso atingir 100 GCU), a execução é bloqueada.
 */
export function checkGcuAllowance(
  wallet: GcuWalletState,
  requiredGcu = 1,
): { allowed: boolean; balance: number; reason?: string } {
  const isFree = wallet.tier.toLowerCase() === "free";

  if (wallet.balance <= 0) {
    return {
      allowed: false,
      balance: 0,
      reason: isFree
        ? "Atingiste o limite de 100 GCU do plano Free. Atualiza para o plano Starter ou Pro para continuares a usar o GRIOT sem restrições."
        : "O teu saldo de GCU esgotou-se. Recarrega a tua carteira em Neoverbis Pay para continuar.",
    };
  }

  if (wallet.balance < requiredGcu) {
    return {
      allowed: false,
      balance: wallet.balance,
      reason: `Saldo insuficiente (${wallet.balance} GCU disponíveis, necessários ${requiredGcu} GCU).`,
    };
  }

  return { allowed: true, balance: wallet.balance };
}

/**
 * Consome GCU de forma real e atómica, sincronizando Supabase e localStorage
 */
export async function consumeGcu(params: {
  userId?: string;
  amount: number;
  label: string;
  modelId?: string;
}): Promise<number> {
  const { userId, amount, label, modelId } = params;
  const current = getLocalGcuBalance();
  const newBalance = Math.max(0, current - amount);

  if (typeof window !== "undefined") {
    localStorage.setItem(GCU_STORAGE_BALANCE_KEY, String(newBalance));
    window.dispatchEvent(
      new CustomEvent("griot:gcu-updated", {
        detail: { balance: newBalance, consumed: amount, label },
      }),
    );
  }

  if (userId && userId !== "anonymous") {
    void (async () => {
      try {
        await supabase
          .from("wallets")
          .update({ balance_gcu: newBalance })
          .eq("user_id", userId);

        await supabase.from("gcu_transactions").insert({
          user_id: userId,
          kind: "usage",
          label: `${label}${modelId ? ` (${modelId})` : ""}`,
          amount_gcu: -amount,
          balance_after: newBalance,
        });
      } catch (err) {
        console.warn("[GCU] Erro ao sincronizar consumo com Supabase:", err);
      }
    })();
  }

  return newBalance;
}
