export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _case_number_counters: {
        Row: {
          last_seq: number
          org_id: string
          year: number
        }
        Insert: {
          last_seq?: number
          org_id: string
          year: number
        }
        Update: {
          last_seq?: number
          org_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "_case_number_counters_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_dataset_items: {
        Row: {
          added_by: string | null
          content: string | null
          created_at: string
          dataset_id: string
          file_path: string | null
          id: string
          jurisdiction: string | null
          outcome: string | null
          tags: string[]
          title: string
          token_count: number | null
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          content?: string | null
          created_at?: string
          dataset_id: string
          file_path?: string | null
          id?: string
          jurisdiction?: string | null
          outcome?: string | null
          tags?: string[]
          title: string
          token_count?: number | null
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          content?: string | null
          created_at?: string
          dataset_id?: string
          file_path?: string | null
          id?: string
          jurisdiction?: string | null
          outcome?: string | null
          tags?: string[]
          title?: string
          token_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_dataset_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_dataset_items_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "ai_datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_datasets: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          purpose: string | null
          source_kind: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          purpose?: string | null
          source_kind?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          purpose?: string | null
          source_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_datasets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_datasets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generation_configs: {
        Row: {
          created_at: string
          dataset_id: string | null
          form_definition_id: string
          input_document_slugs: string[]
          input_form_slugs: string[]
          max_output_tokens: number
          model: string
          output_format: string
          output_language: string
          system_prompt: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          dataset_id?: string | null
          form_definition_id: string
          input_document_slugs?: string[]
          input_form_slugs?: string[]
          max_output_tokens?: number
          model?: string
          output_format?: string
          output_language?: string
          system_prompt: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          dataset_id?: string | null
          form_definition_id?: string
          input_document_slugs?: string[]
          input_form_slugs?: string[]
          max_output_tokens?: number
          model?: string
          output_format?: string
          output_language?: string
          system_prompt?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_generation_configs_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "ai_datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_configs_form_definition_id_fkey"
            columns: ["form_definition_id"]
            isOneToOne: true
            referencedRelation: "form_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_configs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generation_runs: {
        Row: {
          cache_creation_input_tokens: number | null
          cache_read_input_tokens: number | null
          case_id: string
          completed_at: string | null
          config_snapshot: Json
          cost_usd: number | null
          created_at: string
          error: string | null
          form_definition_id: string
          id: string
          input_tokens: number | null
          is_test: boolean
          model: string | null
          output_path: string | null
          output_summary: string | null
          output_text: string | null
          output_tokens: number | null
          party_id: string | null
          progress: Json | null
          requested_by: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          case_id: string
          completed_at?: string | null
          config_snapshot: Json
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          form_definition_id: string
          id?: string
          input_tokens?: number | null
          is_test?: boolean
          model?: string | null
          output_path?: string | null
          output_summary?: string | null
          output_text?: string | null
          output_tokens?: number | null
          party_id?: string | null
          progress?: Json | null
          requested_by?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          case_id?: string
          completed_at?: string | null
          config_snapshot?: Json
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          form_definition_id?: string
          id?: string
          input_tokens?: number | null
          is_test?: boolean
          model?: string | null
          output_path?: string | null
          output_summary?: string | null
          output_text?: string | null
          output_tokens?: number | null
          party_id?: string | null
          progress?: Json | null
          requested_by?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_generation_runs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_runs_form_definition_id_fkey"
            columns: ["form_definition_id"]
            isOneToOne: false
            referencedRelation: "form_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_runs_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "case_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_runs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          cancelled_reason: string | null
          case_id: string | null
          client_user_id: string | null
          created_at: string
          ends_at: string
          id: string
          kind: string
          lead_id: string | null
          livekit_room_id: string | null
          notes: string | null
          reminder_1d: boolean
          reminder_1d_sent_at: string | null
          reminder_1h: boolean
          reminder_1h_sent_at: string | null
          sequence_number: number | null
          service_phase_id: string | null
          staff_id: string
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          cancelled_reason?: string | null
          case_id?: string | null
          client_user_id?: string | null
          created_at?: string
          ends_at: string
          id?: string
          kind?: string
          lead_id?: string | null
          livekit_room_id?: string | null
          notes?: string | null
          reminder_1d?: boolean
          reminder_1d_sent_at?: string | null
          reminder_1h?: boolean
          reminder_1h_sent_at?: string | null
          sequence_number?: number | null
          service_phase_id?: string | null
          staff_id: string
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          cancelled_reason?: string | null
          case_id?: string | null
          client_user_id?: string | null
          created_at?: string
          ends_at?: string
          id?: string
          kind?: string
          lead_id?: string | null
          livekit_room_id?: string | null
          notes?: string | null
          reminder_1d?: boolean
          reminder_1d_sent_at?: string | null
          reminder_1h?: boolean
          reminder_1h_sent_at?: string | null
          sequence_number?: number | null
          service_phase_id?: string | null
          staff_id?: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_user_id_fkey"
            columns: ["client_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_phase_id_fkey"
            columns: ["service_phase_id"]
            isOneToOne: false
            referencedRelation: "service_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          diff: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          ip: unknown
          org_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          diff?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip?: unknown
          org_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          diff?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip?: unknown
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_exceptions: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          reason: string | null
          staff_id: string
          starts_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          reason?: string | null
          staff_id: string
          starts_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          reason?: string | null
          staff_id?: string
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          created_at: string
          end_local: string
          id: string
          is_active: boolean
          staff_id: string
          start_local: string
          timezone: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_local: string
          id?: string
          is_active?: boolean
          staff_id: string
          start_local: string
          timezone: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_local?: string
          id?: string
          is_active?: boolean
          staff_id?: string
          start_local?: string
          timezone?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      broadcast_campaigns: {
        Row: {
          audience: Json
          body_html: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string
          scheduled_at: string | null
          sent_count: number
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          audience: Json
          body_html: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id: string
          scheduled_at?: string | null
          sent_count?: number
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          audience?: Json
          body_html?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string
          scheduled_at?: string | null
          sent_count?: number
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "broadcast_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          answered_at: string | null
          appointment_id: string | null
          conversation_id: string
          created_at: string
          duration_seconds: number | null
          ended_at: string | null
          id: string
          kind: string
          livekit_room: string
          participants: Json
          started_at: string
          started_by: string
          status: string
          updated_at: string
        }
        Insert: {
          answered_at?: string | null
          appointment_id?: string | null
          conversation_id: string
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          kind: string
          livekit_room: string
          participants?: Json
          started_at: string
          started_by: string
          status?: string
          updated_at?: string
        }
        Update: {
          answered_at?: string | null
          appointment_id?: string | null
          conversation_id?: string
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          kind?: string
          livekit_room?: string
          participants?: Json
          started_at?: string
          started_by?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          created_at: string
          email: string
          id: string
          last_event_at: string | null
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          email: string
          id?: string
          last_event_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          email?: string
          id?: string
          last_event_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "broadcast_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      case_documents: {
        Row: {
          case_id: string
          correction_due_at: string | null
          created_at: string
          id: string
          mime_type: string
          original_filename: string
          party_id: string | null
          rejection_reason_i18n: Json | null
          replaces_document_id: string | null
          required_document_type_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          size_bytes: number
          status: string
          storage_path: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          case_id: string
          correction_due_at?: string | null
          created_at?: string
          id?: string
          mime_type: string
          original_filename: string
          party_id?: string | null
          rejection_reason_i18n?: Json | null
          replaces_document_id?: string | null
          required_document_type_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes: number
          status?: string
          storage_path: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          case_id?: string
          correction_due_at?: string | null
          created_at?: string
          id?: string
          mime_type?: string
          original_filename?: string
          party_id?: string | null
          rejection_reason_i18n?: Json | null
          replaces_document_id?: string | null
          required_document_type_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number
          status?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_documents_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "case_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_documents_replaces_document_id_fkey"
            columns: ["replaces_document_id"]
            isOneToOne: false
            referencedRelation: "case_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_documents_required_document_type_id_fkey"
            columns: ["required_document_type_id"]
            isOneToOne: false
            referencedRelation: "required_document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "case_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      case_form_responses: {
        Row: {
          answers: Json
          automation_version_id: string | null
          case_id: string
          created_at: string
          filled_pdf_path: string | null
          form_definition_id: string
          id: string
          party_id: string | null
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          answers?: Json
          automation_version_id?: string | null
          case_id: string
          created_at?: string
          filled_pdf_path?: string | null
          form_definition_id: string
          id?: string
          party_id?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          answers?: Json
          automation_version_id?: string | null
          case_id?: string
          created_at?: string
          filled_pdf_path?: string | null
          form_definition_id?: string
          id?: string
          party_id?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_form_responses_automation_version_id_fkey"
            columns: ["automation_version_id"]
            isOneToOne: false
            referencedRelation: "form_automation_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_form_responses_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_form_responses_form_definition_id_fkey"
            columns: ["form_definition_id"]
            isOneToOne: false
            referencedRelation: "form_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_form_responses_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "case_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      case_members: {
        Row: {
          access_role: string
          case_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_role?: string
          case_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_role?: string
          case_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_members_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      case_overrides: {
        Row: {
          appointment_count: number | null
          case_id: string
          created_at: string
          duration_minutes: number | null
          id: string
          service_phase_id: string
          set_by: string | null
          updated_at: string
        }
        Insert: {
          appointment_count?: number | null
          case_id: string
          created_at?: string
          duration_minutes?: number | null
          id?: string
          service_phase_id: string
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          appointment_count?: number | null
          case_id?: string
          created_at?: string
          duration_minutes?: number | null
          id?: string
          service_phase_id?: string
          set_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_overrides_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_overrides_service_phase_id_fkey"
            columns: ["service_phase_id"]
            isOneToOne: false
            referencedRelation: "service_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_overrides_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      case_parties: {
        Row: {
          case_id: string
          created_at: string
          id: string
          party_role: string
          person_record_id: string | null
          position: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          party_role: string
          person_record_id?: string | null
          position?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          party_role?: string
          person_record_id?: string | null
          position?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_parties_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_parties_person_record_id_fkey"
            columns: ["person_record_id"]
            isOneToOne: false
            referencedRelation: "person_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_parties_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      case_phase_history: {
        Row: {
          case_id: string
          created_at: string
          entered_at: string
          entered_by: string | null
          id: string
          note: string | null
          phase_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          entered_at?: string
          entered_by?: string | null
          id?: string
          note?: string | null
          phase_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          entered_at?: string
          entered_by?: string | null
          id?: string
          note?: string | null
          phase_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_phase_history_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_phase_history_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_phase_history_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "service_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_requirement_overrides: {
        Row: {
          case_id: string
          created_at: string
          created_by: string | null
          custom_label_i18n: Json | null
          id: string
          is_hidden: boolean
          is_required: boolean | null
          party_id: string | null
          required_document_type_id: string | null
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by?: string | null
          custom_label_i18n?: Json | null
          id?: string
          is_hidden?: boolean
          is_required?: boolean | null
          party_id?: string | null
          required_document_type_id?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string | null
          custom_label_i18n?: Json | null
          id?: string
          is_hidden?: boolean
          is_required?: boolean | null
          party_id?: string | null
          required_document_type_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_requirement_overrides_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_requirement_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "case_requirement_overrides_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "case_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_requirement_overrides_required_document_type_id_fkey"
            columns: ["required_document_type_id"]
            isOneToOne: false
            referencedRelation: "required_document_types"
            referencedColumns: ["id"]
          },
        ]
      }
      case_timeline: {
        Row: {
          actor_kind: string
          actor_user_id: string | null
          body_i18n: Json | null
          case_id: string
          color: string
          created_at: string
          event_type: string
          icon: string
          id: string
          occurred_at: string
          title_i18n: Json
          visible_to_client: boolean
        }
        Insert: {
          actor_kind: string
          actor_user_id?: string | null
          body_i18n?: Json | null
          case_id: string
          color?: string
          created_at?: string
          event_type: string
          icon?: string
          id?: string
          occurred_at?: string
          title_i18n: Json
          visible_to_client?: boolean
        }
        Update: {
          actor_kind?: string
          actor_user_id?: string | null
          body_i18n?: Json | null
          case_id?: string
          color?: string
          created_at?: string
          event_type?: string
          icon?: string
          id?: string
          occurred_at?: string
          title_i18n?: Json
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "case_timeline_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_timeline_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          assigned_paralegal_id: string | null
          assigned_sales_id: string | null
          case_number: string
          completed_at: string | null
          created_at: string
          current_phase_id: string | null
          id: string
          internal_note: string | null
          opened_at: string | null
          org_id: string
          primary_client_id: string
          rebooking_blocked_until: string | null
          service_id: string
          service_plan_id: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_paralegal_id?: string | null
          assigned_sales_id?: string | null
          case_number: string
          completed_at?: string | null
          created_at?: string
          current_phase_id?: string | null
          id?: string
          internal_note?: string | null
          opened_at?: string | null
          org_id: string
          primary_client_id: string
          rebooking_blocked_until?: string | null
          service_id: string
          service_plan_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_paralegal_id?: string | null
          assigned_sales_id?: string | null
          case_number?: string
          completed_at?: string | null
          created_at?: string
          current_phase_id?: string | null
          id?: string
          internal_note?: string | null
          opened_at?: string | null
          org_id?: string
          primary_client_id?: string
          rebooking_blocked_until?: string | null
          service_id?: string
          service_plan_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_assigned_paralegal_id_fkey"
            columns: ["assigned_paralegal_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cases_assigned_sales_id_fkey"
            columns: ["assigned_sales_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cases_current_phase_id_fkey"
            columns: ["current_phase_id"]
            isOneToOne: false
            referencedRelation: "service_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_primary_client_id_fkey"
            columns: ["primary_client_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_service_plan_id_fkey"
            columns: ["service_plan_id"]
            isOneToOne: false
            referencedRelation: "service_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      client_profiles: {
        Row: {
          address: Json | null
          country_of_origin: string | null
          created_at: string
          first_name: string
          last_name: string
          marketing_opt_in: boolean
          pii_encrypted: Json
          preferred_name: string | null
          tutorial_seen_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: Json | null
          country_of_origin?: string | null
          created_at?: string
          first_name: string
          last_name: string
          marketing_opt_in?: boolean
          pii_encrypted?: Json
          preferred_name?: string | null
          tutorial_seen_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: Json | null
          country_of_origin?: string | null
          created_at?: string
          first_name?: string
          last_name?: string
          marketing_opt_in?: boolean
          pii_encrypted?: Json
          preferred_name?: string | null
          tutorial_seen_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          is_hidden: boolean
          post_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          post_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_hidden?: boolean
          post_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          author_display: string | null
          author_staff_id: string | null
          body: string | null
          created_at: string
          id: string
          is_published: boolean
          kind: string
          live_join_url: string | null
          live_starts_at: string | null
          org_id: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          author_display?: string | null
          author_staff_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          kind?: string
          live_join_url?: string | null
          live_starts_at?: string | null
          org_id: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          author_display?: string | null
          author_staff_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          is_published?: boolean
          kind?: string
          live_join_url?: string | null
          live_starts_at?: string | null
          org_id?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "community_posts_author_staff_id_fkey"
            columns: ["author_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "community_posts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      community_reactions: {
        Row: {
          created_at: string
          id: string
          kind: string
          post_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          post_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          post_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "community_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_terms_acceptances: {
        Row: {
          accepted_at: string
          case_id: string
          created_at: string
          id: string
          ip: unknown
          signature_image_path: string
          terms_version: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          case_id: string
          created_at?: string
          id?: string
          ip?: unknown
          signature_image_path: string
          terms_version: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          case_id?: string
          created_at?: string
          id?: string
          ip?: unknown
          signature_image_path?: string
          terms_version?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_terms_acceptances_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_terms_acceptances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          case_id: string | null
          created_at: string
          created_by: string | null
          id: string
          lead_id: string | null
          org_id: string
          parties_snapshot: Json
          plan_snapshot: Json
          service_id: string
          service_plan_id: string
          signature_image_path: string | null
          signed_at: string | null
          signed_ip: unknown
          signed_pdf_path: string | null
          signing_expires_at: string | null
          signing_token: string | null
          status: string
          terms_version: string | null
          updated_at: string
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          org_id: string
          parties_snapshot: Json
          plan_snapshot: Json
          service_id: string
          service_plan_id: string
          signature_image_path?: string | null
          signed_at?: string | null
          signed_ip?: unknown
          signed_pdf_path?: string | null
          signing_expires_at?: string | null
          signing_token?: string | null
          status?: string
          terms_version?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string | null
          org_id?: string
          parties_snapshot?: Json
          plan_snapshot?: Json
          service_id?: string
          service_plan_id?: string
          signature_image_path?: string | null
          signed_at?: string | null
          signed_ip?: unknown
          signed_pdf_path?: string | null
          signing_expires_at?: string | null
          signing_token?: string | null
          status?: string
          terms_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "contracts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_service_plan_id_fkey"
            columns: ["service_plan_id"]
            isOneToOne: false
            referencedRelation: "service_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          joined_at: string
          last_read_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          case_id: string | null
          created_at: string
          id: string
          last_message_at: string | null
          lead_id: string | null
          org_id: string
          scope: string
          title: string | null
          updated_at: string
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          org_id: string
          scope: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          lead_id?: string | null
          org_id?: string
          scope?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      cover_renders: {
        Row: {
          case_id: string
          created_at: string
          created_by: string | null
          data: Json
          id: string
          pdf_path: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          pdf_path: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          pdf_path?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cover_renders_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cover_renders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cover_renders_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "cover_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      cover_templates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          template: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          template: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          template?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cover_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      document_extractions: {
        Row: {
          case_document_id: string
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          error: string | null
          id: string
          input_tokens: number | null
          model: string
          output_tokens: number | null
          payload: Json | null
          raw_text: string | null
          status: string
          updated_at: string
        }
        Insert: {
          case_document_id: string
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          id?: string
          input_tokens?: number | null
          model: string
          output_tokens?: number | null
          payload?: Json | null
          raw_text?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          case_document_id?: string
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          id?: string
          input_tokens?: number | null
          model?: string
          output_tokens?: number | null
          payload?: Json | null
          raw_text?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_extractions_case_document_id_fkey"
            columns: ["case_document_id"]
            isOneToOne: true
            referencedRelation: "case_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_translations: {
        Row: {
          case_document_id: string
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          direction: string
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          requested_by: string | null
          status: string
          translated_pdf_path: string | null
          translated_text: string | null
          updated_at: string
        }
        Insert: {
          case_document_id: string
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          direction: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          requested_by?: string | null
          status?: string
          translated_pdf_path?: string | null
          translated_text?: string | null
          updated_at?: string
        }
        Update: {
          case_document_id?: string
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          direction?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          requested_by?: string | null
          status?: string
          translated_pdf_path?: string | null
          translated_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_translations_case_document_id_fkey"
            columns: ["case_document_id"]
            isOneToOne: false
            referencedRelation: "case_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_translations_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_module_permissions: {
        Row: {
          can_edit: boolean
          can_view: boolean
          created_at: string
          id: string
          module_key: string
          staff_id: string
          updated_at: string
        }
        Insert: {
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          module_key: string
          staff_id: string
          updated_at?: string
        }
        Update: {
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          module_key?: string
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_module_permissions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      expediente_items: {
        Row: {
          created_at: string
          expediente_id: string
          external_file_path: string | null
          id: string
          include_in_toc: boolean
          item_type: string
          page_count: number | null
          position: number
          ref_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expediente_id: string
          external_file_path?: string | null
          id?: string
          include_in_toc?: boolean
          item_type: string
          page_count?: number | null
          position: number
          ref_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expediente_id?: string
          external_file_path?: string | null
          id?: string
          include_in_toc?: boolean
          item_type?: string
          page_count?: number | null
          position?: number
          ref_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expediente_items_expediente_id_fkey"
            columns: ["expediente_id"]
            isOneToOne: false
            referencedRelation: "expedientes"
            referencedColumns: ["id"]
          },
        ]
      }
      expedientes: {
        Row: {
          attempt_no: number
          built_by: string | null
          case_id: string
          compiled_pdf_path: string | null
          created_at: string
          filed_at: string | null
          id: string
          page_count: number | null
          printed_at: string | null
          printed_by: string | null
          sent_to_finance_at: string | null
          sent_to_finance_by: string | null
          shipped_at: string | null
          status: string
          tracking_ref: string | null
          updated_at: string
        }
        Insert: {
          attempt_no?: number
          built_by?: string | null
          case_id: string
          compiled_pdf_path?: string | null
          created_at?: string
          filed_at?: string | null
          id?: string
          page_count?: number | null
          printed_at?: string | null
          printed_by?: string | null
          sent_to_finance_at?: string | null
          sent_to_finance_by?: string | null
          shipped_at?: string | null
          status?: string
          tracking_ref?: string | null
          updated_at?: string
        }
        Update: {
          attempt_no?: number
          built_by?: string | null
          case_id?: string
          compiled_pdf_path?: string | null
          created_at?: string
          filed_at?: string | null
          id?: string
          page_count?: number | null
          printed_at?: string | null
          printed_by?: string | null
          sent_to_finance_at?: string | null
          sent_to_finance_by?: string | null
          shipped_at?: string | null
          status?: string
          tracking_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expedientes_built_by_fkey"
            columns: ["built_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "expedientes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expedientes_printed_by_fkey"
            columns: ["printed_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "expedientes_sent_to_finance_by_fkey"
            columns: ["sent_to_finance_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      form_automation_versions: {
        Row: {
          created_at: string
          created_by: string | null
          detected_fields: Json
          form_definition_id: string
          id: string
          published_at: string | null
          source_pdf_path: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          detected_fields?: Json
          form_definition_id: string
          id?: string
          published_at?: string | null
          source_pdf_path: string
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          detected_fields?: Json
          form_definition_id?: string
          id?: string
          published_at?: string | null
          source_pdf_path?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_automation_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_automation_versions_form_definition_id_fkey"
            columns: ["form_definition_id"]
            isOneToOne: false
            referencedRelation: "form_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_definitions: {
        Row: {
          created_at: string
          description_i18n: Json | null
          filled_by: string
          id: string
          is_active: boolean
          is_per_party: boolean
          kind: string
          label_i18n: Json
          party_roles: string[] | null
          position: number
          service_phase_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description_i18n?: Json | null
          filled_by?: string
          id?: string
          is_active?: boolean
          is_per_party?: boolean
          kind: string
          label_i18n: Json
          party_roles?: string[] | null
          position?: number
          service_phase_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description_i18n?: Json | null
          filled_by?: string
          id?: string
          is_active?: boolean
          is_per_party?: boolean
          kind?: string
          label_i18n?: Json
          party_roles?: string[] | null
          position?: number
          service_phase_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_definitions_service_phase_id_fkey"
            columns: ["service_phase_id"]
            isOneToOne: false
            referencedRelation: "service_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      form_question_groups: {
        Row: {
          automation_version_id: string
          created_at: string
          id: string
          position: number
          title_i18n: Json
          updated_at: string
        }
        Insert: {
          automation_version_id: string
          created_at?: string
          id?: string
          position: number
          title_i18n: Json
          updated_at?: string
        }
        Update: {
          automation_version_id?: string
          created_at?: string
          id?: string
          position?: number
          title_i18n?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_question_groups_automation_version_id_fkey"
            columns: ["automation_version_id"]
            isOneToOne: false
            referencedRelation: "form_automation_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      form_questions: {
        Row: {
          created_at: string
          field_type: string
          group_id: string
          help_i18n: Json | null
          id: string
          is_required: boolean
          options: Json | null
          pdf_field_name: string | null
          position: number
          question_i18n: Json
          source: string
          source_ref: Json | null
          updated_at: string
          validation: Json | null
        }
        Insert: {
          created_at?: string
          field_type: string
          group_id: string
          help_i18n?: Json | null
          id?: string
          is_required?: boolean
          options?: Json | null
          pdf_field_name?: string | null
          position: number
          question_i18n: Json
          source?: string
          source_ref?: Json | null
          updated_at?: string
          validation?: Json | null
        }
        Update: {
          created_at?: string
          field_type?: string
          group_id?: string
          help_i18n?: Json | null
          id?: string
          is_required?: boolean
          options?: Json | null
          pdf_field_name?: string | null
          position?: number
          question_i18n?: Json
          source?: string
          source_ref?: Json | null
          updated_at?: string
          validation?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "form_questions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "form_question_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      installments: {
        Row: {
          amount_cents: number
          created_at: string
          due_date: string
          id: string
          is_downpayment: boolean
          last_reminder_at: string | null
          number: number
          paid_at: string | null
          payment_plan_id: string
          status: string
          updated_at: string
          waived_by: string | null
          waived_reason: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          due_date: string
          id?: string
          is_downpayment?: boolean
          last_reminder_at?: string | null
          number: number
          paid_at?: string | null
          payment_plan_id: string
          status?: string
          updated_at?: string
          waived_by?: string | null
          waived_reason?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          due_date?: string
          id?: string
          is_downpayment?: boolean
          last_reminder_at?: string | null
          number?: number
          paid_at?: string | null
          payment_plan_id?: string
          status?: string
          updated_at?: string
          waived_by?: string | null
          waived_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installments_payment_plan_id_fkey"
            columns: ["payment_plan_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installments_waived_by_fkey"
            columns: ["waived_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      kanban_boards: {
        Row: {
          board_kind: string
          created_at: string
          id: string
          org_id: string
          owner_staff_id: string
          updated_at: string
        }
        Insert: {
          board_kind: string
          created_at?: string
          id?: string
          org_id: string
          owner_staff_id: string
          updated_at?: string
        }
        Update: {
          board_kind?: string
          created_at?: string
          id?: string
          org_id?: string
          owner_staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kanban_boards_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kanban_boards_owner_staff_id_fkey"
            columns: ["owner_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      kanban_cards: {
        Row: {
          column_id: string
          created_at: string
          id: string
          pinned_note: string | null
          position: number
          ref_id: string
          ref_type: string
          updated_at: string
        }
        Insert: {
          column_id: string
          created_at?: string
          id?: string
          pinned_note?: string | null
          position: number
          ref_id: string
          ref_type: string
          updated_at?: string
        }
        Update: {
          column_id?: string
          created_at?: string
          id?: string
          pinned_note?: string | null
          position?: number
          ref_id?: string
          ref_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kanban_cards_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "kanban_columns"
            referencedColumns: ["id"]
          },
        ]
      }
      kanban_columns: {
        Row: {
          board_id: string
          color: string
          created_at: string
          id: string
          is_terminal_lost: boolean
          is_terminal_won: boolean
          label: string
          position: number
          system_key: string | null
          updated_at: string
        }
        Insert: {
          board_id: string
          color?: string
          created_at?: string
          id?: string
          is_terminal_lost?: boolean
          is_terminal_won?: boolean
          label: string
          position: number
          system_key?: string | null
          updated_at?: string
        }
        Update: {
          board_id?: string
          color?: string
          created_at?: string
          id?: string
          is_terminal_lost?: boolean
          is_terminal_won?: boolean
          label?: string
          position?: number
          system_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kanban_columns_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "kanban_boards"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_categories: {
        Row: {
          color: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          org_id: string
          position: number
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          org_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          org_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          category_id: string | null
          contacted_at: string | null
          created_at: string
          full_name: string | null
          id: string
          interested_service_id: string | null
          lost_reason: string | null
          note: string | null
          org_id: string
          phone_e164: string
          source: string
          status: string
          updated_at: string
          won_case_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          category_id?: string | null
          contacted_at?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          interested_service_id?: string | null
          lost_reason?: string | null
          note?: string | null
          org_id: string
          phone_e164: string
          source?: string
          status?: string
          updated_at?: string
          won_case_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          category_id?: string | null
          contacted_at?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          interested_service_id?: string | null
          lost_reason?: string | null
          note?: string | null
          org_id?: string
          phone_e164?: string
          source?: string
          status?: string
          updated_at?: string
          won_case_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "leads_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "lead_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_interested_service_id_fkey"
            columns: ["interested_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_won_case_fk"
            columns: ["won_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount_cents: number
          case_id: string | null
          category: string
          created_at: string
          description: string | null
          entry_date: string
          id: string
          kind: string
          org_id: string
          payment_id: string | null
          recorded_by: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          case_id?: string | null
          category: string
          created_at?: string
          description?: string | null
          entry_date: string
          id?: string
          kind: string
          org_id: string
          payment_id?: string | null
          recorded_by?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          case_id?: string | null
          category?: string
          created_at?: string
          description?: string | null
          entry_date?: string
          id?: string
          kind?: string
          org_id?: string
          payment_id?: string | null
          recorded_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      legal_validations: {
        Row: {
          ai_score: number | null
          attempt_no: number
          case_id: string
          created_at: string
          error: string | null
          expediente_id: string
          external_validation_id: string | null
          id: string
          return_to: string | null
          semaforo: string | null
          sent_at: string | null
          status: string
          updated_at: string
          verdict: string | null
          verdict_at: string | null
          verdict_findings: Json | null
          verdict_notes: string | null
        }
        Insert: {
          ai_score?: number | null
          attempt_no: number
          case_id: string
          created_at?: string
          error?: string | null
          expediente_id: string
          external_validation_id?: string | null
          id?: string
          return_to?: string | null
          semaforo?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          verdict?: string | null
          verdict_at?: string | null
          verdict_findings?: Json | null
          verdict_notes?: string | null
        }
        Update: {
          ai_score?: number | null
          attempt_no?: number
          case_id?: string
          created_at?: string
          error?: string | null
          expediente_id?: string
          external_validation_id?: string | null
          id?: string
          return_to?: string | null
          semaforo?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          verdict?: string | null
          verdict_at?: string | null
          verdict_findings?: Json | null
          verdict_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_validations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_validations_expediente_id_fkey"
            columns: ["expediente_id"]
            isOneToOne: false
            referencedRelation: "expedientes"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json
          body: string | null
          body_translated: Json | null
          conversation_id: string
          created_at: string
          id: string
          kind: string
          sender_user_id: string | null
        }
        Insert: {
          attachments?: Json
          body?: string | null
          body_translated?: Json | null
          conversation_id: string
          created_at?: string
          id?: string
          kind?: string
          sender_user_id?: string | null
        }
        Update: {
          attachments?: Json
          body?: string | null
          body_translated?: Json | null
          conversation_id?: string
          created_at?: string
          id?: string
          kind?: string
          sender_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_user_id_fkey"
            columns: ["sender_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          appointment_reminders: boolean
          case_updates: boolean
          channels: Json
          created_at: string
          messages: boolean
          payment_reminders: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_reminders?: boolean
          case_updates?: boolean
          channels?: Json
          created_at?: string
          messages?: boolean
          payment_reminders?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_reminders?: boolean
          case_updates?: boolean
          channels?: Json
          created_at?: string
          messages?: boolean
          payment_reminders?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          body_i18n: Json | null
          color: string
          created_at: string
          dedupe_key: string | null
          icon: string
          id: string
          read_at: string | null
          title_i18n: Json
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          body_i18n?: Json | null
          color?: string
          created_at?: string
          dedupe_key?: string | null
          icon?: string
          id?: string
          read_at?: string | null
          title_i18n: Json
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          body_i18n?: Json | null
          color?: string
          created_at?: string
          dedupe_key?: string | null
          icon?: string
          id?: string
          read_at?: string | null
          title_i18n?: Json
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          created_at: string
          id: string
          name: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      payment_plans: {
        Row: {
          contract_id: string
          created_at: string
          downpayment_cents: number
          id: string
          installment_count: number
          notes: string | null
          total_cents: number
          updated_at: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          downpayment_cents?: number
          id?: string
          installment_count?: number
          notes?: string | null
          total_cents: number
          updated_at?: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          downpayment_cents?: number
          id?: string
          installment_count?: number
          notes?: string | null
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_plans_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: true
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          installment_id: string
          method: string
          payer_user_id: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
          zelle_proof_path: string | null
        }
        Insert: {
          amount_cents: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          installment_id: string
          method: string
          payer_user_id?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          zelle_proof_path?: string | null
        }
        Update: {
          amount_cents?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          installment_id?: string
          method?: string
          payer_user_id?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          zelle_proof_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payer_user_id_fkey"
            columns: ["payer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      person_records: {
        Row: {
          country_of_birth: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          first_name: string
          id: string
          last_name: string
          org_id: string
          pii_encrypted: Json
          relationship: string | null
          updated_at: string
        }
        Insert: {
          country_of_birth?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          first_name: string
          id?: string
          last_name: string
          org_id: string
          pii_encrypted?: Json
          relationship?: string | null
          updated_at?: string
        }
        Update: {
          country_of_birth?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          first_name?: string
          id?: string
          last_name?: string
          org_id?: string
          pii_encrypted?: Json
          relationship?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      phase_appointment_policies: {
        Row: {
          appointment_count: number
          created_at: string
          duration_minutes: number
          kind: string
          service_phase_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          appointment_count?: number
          created_at?: string
          duration_minutes?: number
          kind?: string
          service_phase_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          appointment_count?: number
          created_at?: string
          duration_minutes?: number
          kind?: string
          service_phase_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phase_appointment_policies_service_phase_id_fkey"
            columns: ["service_phase_id"]
            isOneToOne: true
            referencedRelation: "service_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phase_appointment_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          keys: Json
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          keys: Json
          platform?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          keys?: Json
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      required_document_types: {
        Row: {
          ai_extract: boolean
          category_i18n: Json | null
          created_at: string
          extraction_schema: Json | null
          help_i18n: Json | null
          id: string
          is_active: boolean
          is_per_party: boolean
          is_required: boolean
          label_i18n: Json
          party_roles: string[] | null
          position: number
          requires_certified_copy: boolean
          requires_translation: boolean
          service_phase_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          ai_extract?: boolean
          category_i18n?: Json | null
          created_at?: string
          extraction_schema?: Json | null
          help_i18n?: Json | null
          id?: string
          is_active?: boolean
          is_per_party?: boolean
          is_required?: boolean
          label_i18n: Json
          party_roles?: string[] | null
          position?: number
          requires_certified_copy?: boolean
          requires_translation?: boolean
          service_phase_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          ai_extract?: boolean
          category_i18n?: Json | null
          created_at?: string
          extraction_schema?: Json | null
          help_i18n?: Json | null
          id?: string
          is_active?: boolean
          is_per_party?: boolean
          is_required?: boolean
          label_i18n?: Json
          party_roles?: string[] | null
          position?: number
          requires_certified_copy?: boolean
          requires_translation?: boolean
          service_phase_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "required_document_types_service_phase_id_fkey"
            columns: ["service_phase_id"]
            isOneToOne: false
            referencedRelation: "service_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      service_phase_milestones: {
        Row: {
          created_at: string
          description_i18n: Json | null
          glossary_i18n: Json | null
          icon: string
          id: string
          label_i18n: Json
          position: number
          service_phase_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description_i18n?: Json | null
          glossary_i18n?: Json | null
          icon?: string
          id?: string
          label_i18n: Json
          position: number
          service_phase_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description_i18n?: Json | null
          glossary_i18n?: Json | null
          icon?: string
          id?: string
          label_i18n?: Json
          position?: number
          service_phase_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_phase_milestones_service_phase_id_fkey"
            columns: ["service_phase_id"]
            isOneToOne: false
            referencedRelation: "service_phases"
            referencedColumns: ["id"]
          },
        ]
      }
      service_phases: {
        Row: {
          client_explainer_i18n: Json | null
          created_at: string
          description_i18n: Json | null
          id: string
          label_i18n: Json
          position: number
          service_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          client_explainer_i18n?: Json | null
          created_at?: string
          description_i18n?: Json | null
          id?: string
          label_i18n: Json
          position: number
          service_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          client_explainer_i18n?: Json | null
          created_at?: string
          description_i18n?: Json | null
          id?: string
          label_i18n?: Json
          position?: number
          service_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_phases_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_plans: {
        Row: {
          created_at: string
          currency: string
          default_downpayment_cents: number | null
          default_installments: number
          id: string
          is_active: boolean
          kind: string
          price_cents: number
          requires_lawyer_validation: boolean
          service_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          default_downpayment_cents?: number | null
          default_installments?: number
          id?: string
          is_active?: boolean
          kind: string
          price_cents: number
          requires_lawyer_validation?: boolean
          service_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          default_downpayment_cents?: number | null
          default_installments?: number
          id?: string
          is_active?: boolean
          kind?: string
          price_cents?: number
          requires_lawyer_validation?: boolean
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_plans_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          archived_at: string | null
          benefits_i18n: Json | null
          category: string
          color: string
          created_at: string
          description_i18n: Json | null
          entry_parent_service_id: string | null
          entry_phase_id: string | null
          icon: string
          id: string
          is_active: boolean
          is_public: boolean
          label_i18n: Json
          long_description_i18n: Json | null
          org_id: string
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          benefits_i18n?: Json | null
          category: string
          color?: string
          created_at?: string
          description_i18n?: Json | null
          entry_parent_service_id?: string | null
          entry_phase_id?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          is_public?: boolean
          label_i18n: Json
          long_description_i18n?: Json | null
          org_id: string
          position?: number
          slug: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          benefits_i18n?: Json | null
          category?: string
          color?: string
          created_at?: string
          description_i18n?: Json | null
          entry_parent_service_id?: string | null
          entry_phase_id?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          is_public?: boolean
          label_i18n?: Json
          long_description_i18n?: Json | null
          org_id?: string
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_entry_parent_service_id_fkey"
            columns: ["entry_parent_service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_entry_phase_fk"
            columns: ["entry_phase_id"]
            isOneToOne: false
            referencedRelation: "service_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          role: string
          title_i18n: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          role: string
          title_i18n?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          role?: string
          title_i18n?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_scheduling_settings: {
        Row: {
          buffer_minutes: number
          cancellation_window_hours: number
          created_at: string
          max_advance_days: number
          min_notice_hours: number
          rebooking_penalty_days: number
          staff_id: string
          updated_at: string
        }
        Insert: {
          buffer_minutes?: number
          cancellation_window_hours?: number
          created_at?: string
          max_advance_days?: number
          min_notice_hours?: number
          rebooking_penalty_days?: number
          staff_id: string
          updated_at?: string
        }
        Update: {
          buffer_minutes?: number
          cancellation_window_hours?: number
          created_at?: string
          max_advance_days?: number
          min_notice_hours?: number
          rebooking_penalty_days?: number
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_scheduling_settings_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      staff_tasks: {
        Row: {
          case_id: string | null
          created_at: string
          done_at: string | null
          id: string
          position: number
          staff_id: string
          tag: string | null
          text: string
          updated_at: string
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          position?: number
          staff_id: string
          tag?: string | null
          text: string
          updated_at?: string
        }
        Update: {
          case_id?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          position?: number
          staff_id?: string
          tag?: string | null
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_tasks_case_fk"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tasks_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      stripe_customers: {
        Row: {
          created_at: string
          stripe_customer_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          stripe_customer_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          stripe_customer_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_customers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      terms_versions: {
        Row: {
          body_md_i18n: Json
          created_at: string
          id: string
          is_active: boolean
          org_id: string
          published_at: string | null
          title_i18n: Json
          updated_at: string
          version: string
        }
        Insert: {
          body_md_i18n: Json
          created_at?: string
          id?: string
          is_active?: boolean
          org_id: string
          published_at?: string | null
          title_i18n: Json
          updated_at?: string
          version: string
        }
        Update: {
          body_md_i18n?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          org_id?: string
          published_at?: string | null
          title_i18n?: Json
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "terms_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string | null
          email_bounced_at: string | null
          id: string
          is_active: boolean
          kind: string
          last_seen_at: string | null
          locale: string
          org_id: string
          phone_e164: string | null
          text_scale: number
          theme: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          email_bounced_at?: string | null
          id: string
          is_active?: boolean
          kind: string
          last_seen_at?: string | null
          locale?: string
          org_id: string
          phone_e164?: string | null
          text_scale?: number
          theme?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          email_bounced_at?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          last_seen_at?: string | null
          locale?: string
          org_id?: string
          phone_e164?: string | null
          text_scale?: number
          theme?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          error: string | null
          event_type: string | null
          id: string
          idempotency_key: string
          org_id: string
          processed_at: string | null
          raw_body: Json
          signature_valid: boolean
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_type?: string | null
          id?: string
          idempotency_key: string
          org_id: string
          processed_at?: string | null
          raw_body: Json
          signature_valid: boolean
          source: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          event_type?: string | null
          id?: string
          idempotency_key?: string
          org_id?: string
          processed_at?: string | null
          raw_body?: Json
          signature_valid?: boolean
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_org_id: { Args: never; Returns: string }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      has_module: {
        Args: { module_key: string; need_edit?: boolean }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_case_member: { Args: { case_uuid: string }; Returns: boolean }
      is_client: { Args: never; Returns: boolean }
      is_conversation_participant: { Args: { conv: string }; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      next_case_number: { Args: { org: string }; Returns: string }
      normalize_phone: { Args: { raw: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      staff_role: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
