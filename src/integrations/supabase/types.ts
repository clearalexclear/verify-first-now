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
      case_activity_log: {
        Row: {
          action: Database["public"]["Enums"]["activity_action"]
          actor_id: string | null
          case_id: string
          created_at: string
          id: string
          payload: Json | null
        }
        Insert: {
          action: Database["public"]["Enums"]["activity_action"]
          actor_id?: string | null
          case_id: string
          created_at?: string
          id?: string
          payload?: Json | null
        }
        Update: {
          action?: Database["public"]["Enums"]["activity_action"]
          actor_id?: string | null
          case_id?: string
          created_at?: string
          id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "case_activity_log_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_checks: {
        Row: {
          buyer_impact: string | null
          case_id: string
          confidence: Database["public"]["Enums"]["confidence_level"] | null
          created_at: string
          display_order: number
          evidence_summary: string | null
          finding: string | null
          id: string
          include_in_report: boolean
          internal_notes: string | null
          is_critical: boolean
          question: string
          recommended_action: string | null
          reviewer_approved: boolean
          section_id: string
          source_name: string | null
          source_retrieval_date: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["check_status"] | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          buyer_impact?: string | null
          case_id: string
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          created_at?: string
          display_order?: number
          evidence_summary?: string | null
          finding?: string | null
          id?: string
          include_in_report?: boolean
          internal_notes?: string | null
          is_critical?: boolean
          question: string
          recommended_action?: string | null
          reviewer_approved?: boolean
          section_id: string
          source_name?: string | null
          source_retrieval_date?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["check_status"] | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          buyer_impact?: string | null
          case_id?: string
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          created_at?: string
          display_order?: number
          evidence_summary?: string | null
          finding?: string | null
          id?: string
          include_in_report?: boolean
          internal_notes?: string | null
          is_critical?: boolean
          question?: string
          recommended_action?: string | null
          reviewer_approved?: boolean
          section_id?: string
          source_name?: string | null
          source_retrieval_date?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["check_status"] | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_checks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_checks_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "check_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_checks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "check_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      case_documents: {
        Row: {
          case_id: string
          created_at: string
          extracted_data: Json | null
          filename: string
          id: string
          note: string | null
          storage_path: string | null
          uploaded_by: string | null
          url: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          extracted_data?: Json | null
          filename: string
          id?: string
          note?: string | null
          storage_path?: string | null
          uploaded_by?: string | null
          url?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          extracted_data?: Json | null
          filename?: string
          id?: string
          note?: string | null
          storage_path?: string | null
          uploaded_by?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      check_sections: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      check_templates: {
        Row: {
          created_at: string
          display_order: number
          guidance: string | null
          id: string
          is_active: boolean
          is_critical: boolean
          question: string
          section_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          guidance?: string | null
          id?: string
          is_active?: boolean
          is_critical?: boolean
          question: string
          section_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          guidance?: string | null
          id?: string
          is_active?: boolean
          is_critical?: boolean
          question?: string
          section_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_templates_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "check_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_runs: {
        Row: {
          case_id: string | null
          confidence: string | null
          connector_id: string
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          job_id: string | null
          metadata: Json
          mode: string
          raw_response_path: string | null
          raw_response_storage_allowed: boolean
          request_hash: string | null
          retrieved_at: string
          source_url: string | null
          status: string
        }
        Insert: {
          case_id?: string | null
          confidence?: string | null
          connector_id: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json
          mode: string
          raw_response_path?: string | null
          raw_response_storage_allowed?: boolean
          request_hash?: string | null
          retrieved_at?: string
          source_url?: string | null
          status: string
        }
        Update: {
          case_id?: string | null
          confidence?: string | null
          connector_id?: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          job_id?: string | null
          metadata?: Json
          mode?: string
          raw_response_path?: string | null
          raw_response_storage_allowed?: boolean
          request_hash?: string | null
          retrieved_at?: string
          source_url?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_runs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_runs_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_runs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "investigation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      connectors: {
        Row: {
          category: string
          created_at: string
          enabled: boolean
          id: string
          mode: string
          name: string
          notes: string | null
          raw_response_policy: string
          required_env: string[]
          source_url: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          enabled?: boolean
          id: string
          mode: string
          name: string
          notes?: string | null
          raw_response_policy?: string
          required_env?: string[]
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          enabled?: boolean
          id?: string
          mode?: string
          name?: string
          notes?: string | null
          raw_response_policy?: string
          required_env?: string[]
          source_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          company: string
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          company: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          updated_at?: string
        }
        Update: {
          company?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      evidence_facts: {
        Row: {
          attachment_paths: Json
          case_id: string
          checklist_id: string | null
          classification: Database["public"]["Enums"]["evidence_classification"]
          confidence: string
          connector_run_id: string | null
          created_at: string
          evidence_excerpt: string | null
          evidence_item_id: string | null
          fact_key: string
          fact_value: Json | null
          finding_key: string | null
          id: string
          license_notes: string | null
          manual_entry_created_by: string | null
          raw_response_path: string | null
          retracted_at: string | null
          retracted_by: string | null
          retraction_reason: string | null
          retrieval_date: string
          source_citation: string | null
          source_name: string
          source_url: string | null
        }
        Insert: {
          attachment_paths?: Json
          case_id: string
          checklist_id?: string | null
          classification?: Database["public"]["Enums"]["evidence_classification"]
          confidence?: string
          connector_run_id?: string | null
          created_at?: string
          evidence_excerpt?: string | null
          evidence_item_id?: string | null
          fact_key: string
          fact_value?: Json | null
          finding_key?: string | null
          id?: string
          license_notes?: string | null
          manual_entry_created_by?: string | null
          raw_response_path?: string | null
          retracted_at?: string | null
          retracted_by?: string | null
          retraction_reason?: string | null
          retrieval_date?: string
          source_citation?: string | null
          source_name: string
          source_url?: string | null
        }
        Update: {
          attachment_paths?: Json
          case_id?: string
          checklist_id?: string | null
          classification?: Database["public"]["Enums"]["evidence_classification"]
          confidence?: string
          connector_run_id?: string | null
          created_at?: string
          evidence_excerpt?: string | null
          evidence_item_id?: string | null
          fact_key?: string
          fact_value?: Json | null
          finding_key?: string | null
          id?: string
          license_notes?: string | null
          manual_entry_created_by?: string | null
          raw_response_path?: string | null
          retracted_at?: string | null
          retracted_by?: string | null
          retraction_reason?: string | null
          retrieval_date?: string
          source_citation?: string | null
          source_name?: string
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_facts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_facts_connector_run_id_fkey"
            columns: ["connector_run_id"]
            isOneToOne: false
            referencedRelation: "connector_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_facts_evidence_item_id_fkey"
            columns: ["evidence_item_id"]
            isOneToOne: false
            referencedRelation: "evidence_items"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_items: {
        Row: {
          analyst_comments: string | null
          case_id: string
          check_id: string | null
          classification:
            | Database["public"]["Enums"]["evidence_classification"]
            | null
          client_visible: boolean
          confidence: string | null
          connector_run_id: string | null
          created_at: string
          evidence_type: Database["public"]["Enums"]["evidence_type"]
          id: string
          license_notes: string | null
          raw_response_path: string | null
          related_legal_entity: string | null
          retrieval_date: string | null
          source: string | null
          storage_path: string | null
          title: string
          uploaded_by: string | null
          url: string | null
        }
        Insert: {
          analyst_comments?: string | null
          case_id: string
          check_id?: string | null
          classification?:
            | Database["public"]["Enums"]["evidence_classification"]
            | null
          client_visible?: boolean
          confidence?: string | null
          connector_run_id?: string | null
          created_at?: string
          evidence_type: Database["public"]["Enums"]["evidence_type"]
          id?: string
          license_notes?: string | null
          raw_response_path?: string | null
          related_legal_entity?: string | null
          retrieval_date?: string | null
          source?: string | null
          storage_path?: string | null
          title: string
          uploaded_by?: string | null
          url?: string | null
        }
        Update: {
          analyst_comments?: string | null
          case_id?: string
          check_id?: string | null
          classification?:
            | Database["public"]["Enums"]["evidence_classification"]
            | null
          client_visible?: boolean
          confidence?: string | null
          connector_run_id?: string | null
          created_at?: string
          evidence_type?: Database["public"]["Enums"]["evidence_type"]
          id?: string
          license_notes?: string | null
          raw_response_path?: string | null
          related_legal_entity?: string | null
          retrieval_date?: string | null
          source?: string | null
          storage_path?: string | null
          title?: string
          uploaded_by?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_items_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_items_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "case_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_items_connector_run_id_fkey"
            columns: ["connector_run_id"]
            isOneToOne: false
            referencedRelation: "connector_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_jobs: {
        Row: {
          attempt_count: number
          case_id: string
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          metadata: Json
          next_run_at: string
          order_id: string
          priority: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          case_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          metadata?: Json
          next_run_at?: string
          order_id: string
          priority?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          case_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          metadata?: Json
          next_run_at?: string
          order_id?: string
          priority?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_jobs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_steps: {
        Row: {
          attempt_count: number
          case_id: string
          completed_at: string | null
          created_at: string
          id: string
          input_hash: string | null
          job_id: string
          last_error: string | null
          max_attempts: number
          next_run_at: string
          output: Json | null
          started_at: string | null
          status: string
          step_key: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          case_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          input_hash?: string | null
          job_id: string
          last_error?: string | null
          max_attempts?: number
          next_run_at?: string
          output?: Json | null
          started_at?: string | null
          status?: string
          step_key: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          case_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          input_hash?: string | null
          job_id?: string
          last_error?: string | null
          max_attempts?: number
          next_run_at?: string
          output?: Json | null
          started_at?: string | null
          status?: string
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_steps_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investigation_steps_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "investigation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      official_registry_verification_tasks: {
        Row: {
          case_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          evidence_fact_ids: string[]
          id: string
          job_id: string | null
          reason: string | null
          requested_search_terms: string[]
          status: string
          updated_at: string
        }
        Insert: {
          case_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          evidence_fact_ids?: string[]
          id?: string
          job_id?: string | null
          reason?: string | null
          requested_search_terms?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          evidence_fact_ids?: string[]
          id?: string
          job_id?: string | null
          reason?: string | null
          requested_search_terms?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "official_registry_verification_tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "official_registry_verification_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "investigation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          case_id: string | null
          certificates_info: string | null
          concerns_text: string | null
          created_at: string
          customer_company: string
          customer_email: string
          customer_id: string | null
          customer_name: string
          destination_market: string
          estimated_order_value: string
          id: string
          order_reference: string
          paid_at: string | null
          payment_status: string
          product_category: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          supplier_company_name: string
          supplier_contact_person: string | null
          supplier_country: string
          supplier_id: string | null
          tier_selected: string
          website_marketplace_url: string
        }
        Insert: {
          case_id?: string | null
          certificates_info?: string | null
          concerns_text?: string | null
          created_at?: string
          customer_company: string
          customer_email: string
          customer_id?: string | null
          customer_name: string
          destination_market: string
          estimated_order_value: string
          id?: string
          order_reference?: string
          paid_at?: string | null
          payment_status?: string
          product_category: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          supplier_company_name: string
          supplier_contact_person?: string | null
          supplier_country: string
          supplier_id?: string | null
          tier_selected: string
          website_marketplace_url: string
        }
        Update: {
          case_id?: string | null
          certificates_info?: string | null
          concerns_text?: string | null
          created_at?: string
          customer_company?: string
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          destination_market?: string
          estimated_order_value?: string
          id?: string
          order_reference?: string
          paid_at?: string | null
          payment_status?: string
          product_category?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          supplier_company_name?: string
          supplier_contact_person?: string | null
          supplier_country?: string
          supplier_id?: string | null
          tier_selected?: string
          website_marketplace_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      report_artifacts: {
        Row: {
          artifact_type: string
          case_id: string
          checksum: string | null
          created_at: string
          id: string
          metadata: Json
          report_version_id: string | null
          status: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          artifact_type: string
          case_id: string
          checksum?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          report_version_id?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          artifact_type?: string
          case_id?: string
          checksum?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          report_version_id?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_artifacts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_artifacts_report_version_id_fkey"
            columns: ["report_version_id"]
            isOneToOne: false
            referencedRelation: "report_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      report_versions: {
        Row: {
          buyer_implications: string | null
          case_id: string
          created_at: string
          created_by: string | null
          delivered_at: string | null
          executive_summary: string | null
          final_outcome: Database["public"]["Enums"]["final_outcome"] | null
          finalised_at: string | null
          id: string
          included_check_ids: string[] | null
          independence_statement: string | null
          inspection_recommendation: string | null
          key_findings: Json | null
          limitations: string | null
          methodology: string | null
          overall_risk_rating: Database["public"]["Enums"]["risk_rating"] | null
          payment_recommendation: string | null
          pdf_storage_path: string | null
          recommended_safeguards: string | null
          section_summaries: Json | null
          share_token: string | null
          snapshot: Json | null
          status: Database["public"]["Enums"]["report_status"]
          testing_recommendation: string | null
          version_number: number
        }
        Insert: {
          buyer_implications?: string | null
          case_id: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          executive_summary?: string | null
          final_outcome?: Database["public"]["Enums"]["final_outcome"] | null
          finalised_at?: string | null
          id?: string
          included_check_ids?: string[] | null
          independence_statement?: string | null
          inspection_recommendation?: string | null
          key_findings?: Json | null
          limitations?: string | null
          methodology?: string | null
          overall_risk_rating?:
            | Database["public"]["Enums"]["risk_rating"]
            | null
          payment_recommendation?: string | null
          pdf_storage_path?: string | null
          recommended_safeguards?: string | null
          section_summaries?: Json | null
          share_token?: string | null
          snapshot?: Json | null
          status?: Database["public"]["Enums"]["report_status"]
          testing_recommendation?: string | null
          version_number: number
        }
        Update: {
          buyer_implications?: string | null
          case_id?: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          executive_summary?: string | null
          final_outcome?: Database["public"]["Enums"]["final_outcome"] | null
          finalised_at?: string | null
          id?: string
          included_check_ids?: string[] | null
          independence_statement?: string | null
          inspection_recommendation?: string | null
          key_findings?: Json | null
          limitations?: string | null
          methodology?: string | null
          overall_risk_rating?:
            | Database["public"]["Enums"]["risk_rating"]
            | null
          payment_recommendation?: string | null
          pdf_storage_path?: string | null
          recommended_safeguards?: string | null
          section_summaries?: Json | null
          share_token?: string | null
          snapshot?: Json | null
          status?: Database["public"]["Enums"]["report_status"]
          testing_recommendation?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_versions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      source_snapshots: {
        Row: {
          checksum: string
          created_at: string
          id: string
          last_successful_refresh: string
          payload: Json
          publication_date: string | null
          retrieval_date: string
          snapshot_version: string
          source_key: string
          source_url: string
        }
        Insert: {
          checksum: string
          created_at?: string
          id?: string
          last_successful_refresh?: string
          payload: Json
          publication_date?: string | null
          retrieval_date?: string
          snapshot_version: string
          source_key: string
          source_url: string
        }
        Update: {
          checksum?: string
          created_at?: string
          id?: string
          last_successful_refresh?: string
          payload?: Json
          publication_date?: string | null
          retrieval_date?: string
          snapshot_version?: string
          source_key?: string
          source_url?: string
        }
        Relationships: []
      }
      supplier_cases: {
        Row: {
          assigned_analyst: string | null
          case_reference: string
          completion_pct: number
          created_at: string
          customer_concerns: string | null
          customer_id: string | null
          deadline: string | null
          destination_market: string | null
          estimated_order_value: string | null
          final_outcome: Database["public"]["Enums"]["final_outcome"] | null
          id: string
          investigation_completed_at: string | null
          investigation_error: string | null
          investigation_started_at: string | null
          order_id: string | null
          overall_risk_rating: Database["public"]["Enums"]["risk_rating"] | null
          package: string
          product_category: string | null
          product_description: string | null
          resolved_entity: Json | null
          status: Database["public"]["Enums"]["case_status"]
          suggested_outcome: Database["public"]["Enums"]["final_outcome"] | null
          supplier_chinese_name: string | null
          supplier_id: string | null
          updated_at: string
          upload_token: string | null
        }
        Insert: {
          assigned_analyst?: string | null
          case_reference?: string
          completion_pct?: number
          created_at?: string
          customer_concerns?: string | null
          customer_id?: string | null
          deadline?: string | null
          destination_market?: string | null
          estimated_order_value?: string | null
          final_outcome?: Database["public"]["Enums"]["final_outcome"] | null
          id?: string
          investigation_completed_at?: string | null
          investigation_error?: string | null
          investigation_started_at?: string | null
          order_id?: string | null
          overall_risk_rating?:
            | Database["public"]["Enums"]["risk_rating"]
            | null
          package: string
          product_category?: string | null
          product_description?: string | null
          resolved_entity?: Json | null
          status?: Database["public"]["Enums"]["case_status"]
          suggested_outcome?:
            | Database["public"]["Enums"]["final_outcome"]
            | null
          supplier_chinese_name?: string | null
          supplier_id?: string | null
          updated_at?: string
          upload_token?: string | null
        }
        Update: {
          assigned_analyst?: string | null
          case_reference?: string
          completion_pct?: number
          created_at?: string
          customer_concerns?: string | null
          customer_id?: string | null
          deadline?: string | null
          destination_market?: string | null
          estimated_order_value?: string | null
          final_outcome?: Database["public"]["Enums"]["final_outcome"] | null
          id?: string
          investigation_completed_at?: string | null
          investigation_error?: string | null
          investigation_started_at?: string | null
          order_id?: string | null
          overall_risk_rating?:
            | Database["public"]["Enums"]["risk_rating"]
            | null
          package?: string
          product_category?: string | null
          product_description?: string | null
          resolved_entity?: Json | null
          status?: Database["public"]["Enums"]["case_status"]
          suggested_outcome?:
            | Database["public"]["Enums"]["final_outcome"]
            | null
          supplier_chinese_name?: string | null
          supplier_id?: string | null
          updated_at?: string
          upload_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_cases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_cases_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_cases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_communications: {
        Row: {
          analyst_assessment: string | null
          case_id: string
          comm_date: string
          created_at: string
          created_by: string | null
          documents_received: string | null
          id: string
          question: string
          response: string | null
          response_status: Database["public"]["Enums"]["response_status"] | null
          updated_at: string
        }
        Insert: {
          analyst_assessment?: string | null
          case_id: string
          comm_date?: string
          created_at?: string
          created_by?: string | null
          documents_received?: string | null
          id?: string
          question: string
          response?: string | null
          response_status?:
            | Database["public"]["Enums"]["response_status"]
            | null
          updated_at?: string
        }
        Update: {
          analyst_assessment?: string | null
          case_id?: string
          comm_date?: string
          created_at?: string
          created_by?: string | null
          documents_received?: string | null
          id?: string
          question?: string
          response?: string | null
          response_status?:
            | Database["public"]["Enums"]["response_status"]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_communications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "supplier_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          cn_vn_legal_name: string | null
          contact_person: string | null
          country: string
          created_at: string
          id: string
          marketplace_url: string | null
          registered_legal_name: string | null
          stated_name: string
          updated_at: string
          website: string | null
        }
        Insert: {
          cn_vn_legal_name?: string | null
          contact_person?: string | null
          country: string
          created_at?: string
          id?: string
          marketplace_url?: string | null
          registered_legal_name?: string | null
          stated_name: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          cn_vn_legal_name?: string | null
          contact_person?: string | null
          country?: string
          created_at?: string
          id?: string
          marketplace_url?: string | null
          registered_legal_name?: string | null
          stated_name?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          payload: Json | null
          processed_at: string | null
          processing_status: string
          provider: string
          provider_event_id: string
          signature_valid: boolean
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          payload?: Json | null
          processed_at?: string | null
          processing_status?: string
          provider?: string
          provider_event_id: string
          signature_valid?: boolean
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          payload?: Json | null
          processed_at?: string | null
          processing_status?: string
          provider?: string
          provider_event_id?: string
          signature_valid?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      activity_action:
        | "case_created"
        | "analyst_assigned"
        | "status_changed"
        | "document_uploaded"
        | "finding_modified"
        | "risk_rating_modified"
        | "report_generated"
        | "report_delivered"
        | "outcome_set"
        | "evidence_added"
        | "communication_logged"
      app_role: "admin" | "analyst"
      case_status:
        | "new"
        | "information_required"
        | "research_in_progress"
        | "supplier_clarification_pending"
        | "review_required"
        | "report_ready"
        | "delivered"
        | "cancelled"
        | "payment_pending"
        | "awaiting_documents"
        | "ready_for_research"
        | "investigation_queued"
        | "investigating"
        | "investigation_failed"
      check_status:
        | "pass"
        | "caution"
        | "fail"
        | "not_verified"
        | "not_applicable"
      confidence_level: "high" | "medium_high" | "medium" | "low"
      evidence_classification:
        | "VERIFIED"
        | "CORROBORATED"
        | "SUPPLIER_CLAIMED"
        | "INFERRED"
        | "NOT_INDEPENDENTLY_VERIFIED"
        | "CONTRADICTED"
      evidence_type:
        | "screenshot"
        | "business_licence"
        | "certificate"
        | "registry_extract"
        | "court_record"
        | "shipment_data"
        | "supplier_email"
        | "quotation"
        | "invoice"
        | "bank_instructions"
        | "test_report"
        | "website_page"
        | "other"
      final_outcome:
        | "go"
        | "proceed_with_safeguards"
        | "pause_pending_clarification"
        | "no_go"
      report_status: "draft" | "final" | "delivered"
      response_status:
        | "satisfactory"
        | "incomplete"
        | "contradictory"
        | "no_response"
      risk_rating: "low" | "medium" | "high" | "critical"
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
    Enums: {
      activity_action: [
        "case_created",
        "analyst_assigned",
        "status_changed",
        "document_uploaded",
        "finding_modified",
        "risk_rating_modified",
        "report_generated",
        "report_delivered",
        "outcome_set",
        "evidence_added",
        "communication_logged",
      ],
      app_role: ["admin", "analyst"],
      case_status: [
        "new",
        "information_required",
        "research_in_progress",
        "supplier_clarification_pending",
        "review_required",
        "report_ready",
        "delivered",
        "cancelled",
        "payment_pending",
        "awaiting_documents",
        "ready_for_research",
        "investigation_queued",
        "investigating",
        "investigation_failed",
      ],
      check_status: [
        "pass",
        "caution",
        "fail",
        "not_verified",
        "not_applicable",
      ],
      confidence_level: ["high", "medium_high", "medium", "low"],
      evidence_classification: [
        "VERIFIED",
        "CORROBORATED",
        "SUPPLIER_CLAIMED",
        "INFERRED",
        "NOT_INDEPENDENTLY_VERIFIED",
        "CONTRADICTED",
      ],
      evidence_type: [
        "screenshot",
        "business_licence",
        "certificate",
        "registry_extract",
        "court_record",
        "shipment_data",
        "supplier_email",
        "quotation",
        "invoice",
        "bank_instructions",
        "test_report",
        "website_page",
        "other",
      ],
      final_outcome: [
        "go",
        "proceed_with_safeguards",
        "pause_pending_clarification",
        "no_go",
      ],
      report_status: ["draft", "final", "delivered"],
      response_status: [
        "satisfactory",
        "incomplete",
        "contradictory",
        "no_response",
      ],
      risk_rating: ["low", "medium", "high", "critical"],
    },
  },
} as const
