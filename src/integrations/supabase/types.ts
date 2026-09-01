export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      agents: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          project_id: string | null;
          role: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          project_id?: string | null;
          role?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          project_id?: string | null;
          role?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agents_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      alerts: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          message: string;
          project_id: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          message: string;
          project_id?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          message?: string;
          project_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alerts_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      capsule_activity: {
        Row: {
          action: string;
          capsule_id: string;
          created_at: string;
          id: string;
          ref_id: string | null;
          ref_type: string | null;
          summary: string;
          user_id: string;
        };
        Insert: {
          action: string;
          capsule_id: string;
          created_at?: string;
          id?: string;
          ref_id?: string | null;
          ref_type?: string | null;
          summary: string;
          user_id: string;
        };
        Update: {
          action?: string;
          capsule_id?: string;
          created_at?: string;
          id?: string;
          ref_id?: string | null;
          ref_type?: string | null;
          summary?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "capsule_activity_capsule_id_fkey";
            columns: ["capsule_id"];
            isOneToOne: false;
            referencedRelation: "capsules";
            referencedColumns: ["id"];
          },
        ];
      };
      capsule_asset_links: {
        Row: {
          asset_id: string;
          capsule_id: string;
          caption: string | null;
          created_at: string;
          id: string;
          layout: string | null;
          position: number;
          section: string | null;
          target_id: string | null;
          target_type: string;
          user_id: string;
        };
        Insert: {
          asset_id: string;
          capsule_id: string;
          caption?: string | null;
          created_at?: string;
          id?: string;
          layout?: string | null;
          position?: number;
          section?: string | null;
          target_id?: string | null;
          target_type: string;
          user_id: string;
        };
        Update: {
          asset_id?: string;
          capsule_id?: string;
          caption?: string | null;
          created_at?: string;
          id?: string;
          layout?: string | null;
          position?: number;
          section?: string | null;
          target_id?: string | null;
          target_type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "capsule_asset_links_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "capsule_assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capsule_asset_links_capsule_id_fkey";
            columns: ["capsule_id"];
            isOneToOne: false;
            referencedRelation: "capsules";
            referencedColumns: ["id"];
          },
        ];
      };
      capsule_assets: {
        Row: {
          capsule_id: string;
          caption: string | null;
          created_at: string;
          deleted_at: string | null;
          description: string | null;
          id: string;
          mime_type: string | null;
          name: string;
          notes: string | null;
          source: string | null;
          status: string;
          storage_path: string;
          title: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          capsule_id: string;
          caption?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          mime_type?: string | null;
          name: string;
          notes?: string | null;
          source?: string | null;
          status?: string;
          storage_path: string;
          title?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          capsule_id?: string;
          caption?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          mime_type?: string | null;
          name?: string;
          notes?: string | null;
          source?: string | null;
          status?: string;
          storage_path?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "capsule_assets_capsule_id_fkey";
            columns: ["capsule_id"];
            isOneToOne: false;
            referencedRelation: "capsules";
            referencedColumns: ["id"];
          },
        ];
      };
      capsule_decision_revisions: {
        Row: {
          actor: string;
          capsule_id: string;
          created_at: string;
          decision_id: string;
          description: string | null;
          id: string;
          reason: string | null;
          status: string;
          title: string;
          user_id: string;
          version: number;
        };
        Insert: {
          actor?: string;
          capsule_id: string;
          created_at?: string;
          decision_id: string;
          description?: string | null;
          id?: string;
          reason?: string | null;
          status: string;
          title: string;
          user_id: string;
          version: number;
        };
        Update: {
          actor?: string;
          capsule_id?: string;
          created_at?: string;
          decision_id?: string;
          description?: string | null;
          id?: string;
          reason?: string | null;
          status?: string;
          title?: string;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "capsule_decision_revisions_capsule_id_fkey";
            columns: ["capsule_id"];
            isOneToOne: false;
            referencedRelation: "capsules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capsule_decision_revisions_decision_id_fkey";
            columns: ["decision_id"];
            isOneToOne: false;
            referencedRelation: "capsule_decisions";
            referencedColumns: ["id"];
          },
        ];
      };
      capsule_decisions: {
        Row: {
          affected_entities: string[];
          approved_at: string | null;
          approved_by: string | null;
          capsule_id: string;
          created_at: string;
          description: string | null;
          id: string;
          idempotency_key: string | null;
          metadata: Json;
          proposed_by: string;
          reason: string | null;
          section: string;
          status: string;
          superseded_at: string | null;
          superseded_by: string | null;
          tags: string[];
          title: string;
          updated_at: string;
          user_id: string;
          version: number;
        };
        Insert: {
          affected_entities?: string[];
          approved_at?: string | null;
          approved_by?: string | null;
          capsule_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          idempotency_key?: string | null;
          metadata?: Json;
          proposed_by?: string;
          reason?: string | null;
          section?: string;
          status?: string;
          superseded_at?: string | null;
          superseded_by?: string | null;
          tags?: string[];
          title: string;
          updated_at?: string;
          user_id: string;
          version?: number;
        };
        Update: {
          affected_entities?: string[];
          approved_at?: string | null;
          approved_by?: string | null;
          capsule_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          idempotency_key?: string | null;
          metadata?: Json;
          proposed_by?: string;
          reason?: string | null;
          section?: string;
          status?: string;
          superseded_at?: string | null;
          superseded_by?: string | null;
          tags?: string[];
          title?: string;
          updated_at?: string;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "capsule_decisions_capsule_id_fkey";
            columns: ["capsule_id"];
            isOneToOne: false;
            referencedRelation: "capsules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capsule_decisions_superseded_by_fkey";
            columns: ["superseded_by"];
            isOneToOne: false;
            referencedRelation: "capsule_decisions";
            referencedColumns: ["id"];
          },
        ];
      };
      capsule_entities: {
        Row: {
          capsule_id: string;
          created_at: string;
          deleted_at: string | null;
          description: string | null;
          entity_type: string;
          id: string;
          name: string;
          properties: Json;
          status: string;
          updated_at: string;
          user_id: string;
          version: number;
        };
        Insert: {
          capsule_id: string;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          entity_type?: string;
          id?: string;
          name: string;
          properties?: Json;
          status?: string;
          updated_at?: string;
          user_id: string;
          version?: number;
        };
        Update: {
          capsule_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          entity_type?: string;
          id?: string;
          name?: string;
          properties?: Json;
          status?: string;
          updated_at?: string;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "capsule_entities_capsule_id_fkey";
            columns: ["capsule_id"];
            isOneToOne: false;
            referencedRelation: "capsules";
            referencedColumns: ["id"];
          },
        ];
      };
      capsule_entity_relationships: {
        Row: {
          capsule_id: string;
          created_at: string;
          from_entity_id: string;
          id: string;
          relation: string;
          to_entity_id: string;
          user_id: string;
        };
        Insert: {
          capsule_id: string;
          created_at?: string;
          from_entity_id: string;
          id?: string;
          relation: string;
          to_entity_id: string;
          user_id: string;
        };
        Update: {
          capsule_id?: string;
          created_at?: string;
          from_entity_id?: string;
          id?: string;
          relation?: string;
          to_entity_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "capsule_entity_relationships_capsule_id_fkey";
            columns: ["capsule_id"];
            isOneToOne: false;
            referencedRelation: "capsules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capsule_entity_relationships_from_entity_id_fkey";
            columns: ["from_entity_id"];
            isOneToOne: false;
            referencedRelation: "capsule_entities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "capsule_entity_relationships_to_entity_id_fkey";
            columns: ["to_entity_id"];
            isOneToOne: false;
            referencedRelation: "capsule_entities";
            referencedColumns: ["id"];
          },
        ];
      };
      capsule_phases: {
        Row: {
          capsule_id: string;
          created_at: string;
          id: string;
          position: number;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          capsule_id: string;
          created_at?: string;
          id?: string;
          position?: number;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          capsule_id?: string;
          created_at?: string;
          id?: string;
          position?: number;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "capsule_phases_capsule_id_fkey";
            columns: ["capsule_id"];
            isOneToOne: false;
            referencedRelation: "capsules";
            referencedColumns: ["id"];
          },
        ];
      };
      capsules: {
        Row: {
          archived_at: string | null;
          created_at: string;
          current_phase_id: string | null;
          deleted_at: string | null;
          description: string | null;
          due_at: string | null;
          group_work: boolean;
          id: string;
          name: string;
          status: string;
          subjects: string[];
          teacher: string | null;
          type: string;
          updated_at: string;
          user_id: string;
          work_kind: string | null;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          current_phase_id?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          due_at?: string | null;
          group_work?: boolean;
          id?: string;
          name: string;
          status?: string;
          subjects?: string[];
          teacher?: string | null;
          type?: string;
          updated_at?: string;
          user_id: string;
          work_kind?: string | null;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          current_phase_id?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          due_at?: string | null;
          group_work?: boolean;
          id?: string;
          name?: string;
          status?: string;
          subjects?: string[];
          teacher?: string | null;
          type?: string;
          updated_at?: string;
          user_id?: string;
          work_kind?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "capsules_current_phase_id_fkey";
            columns: ["current_phase_id"];
            isOneToOne: false;
            referencedRelation: "capsule_phases";
            referencedColumns: ["id"];
          },
        ];
      };
      captures: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          latitude: number | null;
          longitude: number | null;
          mime_type: string | null;
          note: string | null;
          project_id: string | null;
          storage_path: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          latitude?: number | null;
          longitude?: number | null;
          mime_type?: string | null;
          note?: string | null;
          project_id?: string | null;
          storage_path?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          latitude?: number | null;
          longitude?: number | null;
          mime_type?: string | null;
          note?: string | null;
          project_id?: string | null;
          storage_path?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "captures_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          archived: boolean;
          capsule_id: string | null;
          created_at: string;
          id: string;
          model: string;
          pinned: boolean;
          project_id: string | null;
          scope: string;
          title: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived?: boolean;
          capsule_id?: string | null;
          created_at?: string;
          id?: string;
          model?: string;
          pinned?: boolean;
          project_id?: string | null;
          scope?: string;
          title?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived?: boolean;
          capsule_id?: string | null;
          created_at?: string;
          id?: string;
          model?: string;
          pinned?: boolean;
          project_id?: string | null;
          scope?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_capsule_id_fkey";
            columns: ["capsule_id"];
            isOneToOne: false;
            referencedRelation: "capsules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      gcu_transactions: {
        Row: {
          amount_gcu: number;
          counterparty: string | null;
          created_at: string;
          id: string;
          kind: string;
          label: string;
          user_id: string;
        };
        Insert: {
          amount_gcu?: number;
          counterparty?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          label: string;
          user_id: string;
        };
        Update: {
          amount_gcu?: number;
          counterparty?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          label?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      logs: {
        Row: {
          created_at: string;
          id: string;
          level: string;
          message: string;
          project_id: string | null;
          source: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          level?: string;
          message: string;
          project_id?: string | null;
          source?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          level?: string;
          message?: string;
          project_id?: string | null;
          source?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "logs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string;
          feedback: string | null;
          id: string;
          model: string | null;
          role: string;
          user_id: string;
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string;
          feedback?: string | null;
          id?: string;
          model?: string | null;
          role: string;
          user_id: string;
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string;
          feedback?: string | null;
          id?: string;
          model?: string | null;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          active_project_id: string | null;
          created_at: string;
          desktop_last_seen: string | null;
          desktop_online: boolean;
          display_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          active_project_id?: string | null;
          created_at?: string;
          desktop_last_seen?: string | null;
          desktop_online?: boolean;
          display_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          active_project_id?: string | null;
          created_at?: string;
          desktop_last_seen?: string | null;
          desktop_online?: boolean;
          display_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_active_project_id_fkey";
            columns: ["active_project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          archived: boolean;
          build_status: string | null;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          progress: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived?: boolean;
          build_status?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          progress?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived?: boolean;
          build_status?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          progress?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      pull_requests: {
        Row: {
          branch: string | null;
          created_at: string;
          id: string;
          number: number;
          project_id: string | null;
          status: string;
          summary: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          branch?: string | null;
          created_at?: string;
          id?: string;
          number: number;
          project_id?: string | null;
          status?: string;
          summary?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          branch?: string | null;
          created_at?: string;
          id?: string;
          number?: number;
          project_id?: string | null;
          status?: string;
          summary?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pull_requests_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      runs: {
        Row: {
          cost_usd: number;
          created_at: string;
          duration_ms: number | null;
          id: string;
          label: string;
          project_id: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          cost_usd?: number;
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          label: string;
          project_id?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          cost_usd?: number;
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          label?: string;
          project_id?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "runs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      services: {
        Row: {
          cost_usd: number;
          created_at: string;
          id: string;
          kind: string;
          name: string;
          status: string;
          updated_at: string;
          usage_units: number;
          user_id: string;
        };
        Insert: {
          cost_usd?: number;
          created_at?: string;
          id?: string;
          kind: string;
          name: string;
          status?: string;
          updated_at?: string;
          usage_units?: number;
          user_id: string;
        };
        Update: {
          cost_usd?: number;
          created_at?: string;
          id?: string;
          kind?: string;
          name?: string;
          status?: string;
          updated_at?: string;
          usage_units?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      tasks: {
        Row: {
          created_at: string;
          id: string;
          priority: string;
          project_id: string | null;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          priority?: string;
          project_id?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          priority?: string;
          project_id?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      wallets: {
        Row: {
          balance_gcu: number;
          created_at: string;
          handle: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          balance_gcu?: number;
          created_at?: string;
          handle: string;
          id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          balance_gcu?: number;
          created_at?: string;
          handle?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
