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
      evidence_items: {
        Row: {
          analyst_comments: string | null
          case_id: string
          check_id: string | null
          client_visible: boolean
          created_at: string
          evidence_type: Database["public"]["Enums"]["evidence_type"]
          id: string
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
          client_visible?: boolean
          created_at?: string
          evidence_type: Database["public"]["Enums"]["evidence_type"]
          id?: string
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
          client_visible?: boolean
          created_at?: string
          evidence_type?: Database["public"]["Enums"]["evidence_type"]
          id?: string
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
          payment_status: string
          product_category: string
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
          payment_status?: string
          product_category: string
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
          payment_status?: string
          product_category?: string
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
          order_id: string | null
          overall_risk_rating: Database["public"]["Enums"]["risk_rating"] | null
          package: string
          product_category: string | null
          status: Database["public"]["Enums"]["case_status"]
          suggested_outcome: Database["public"]["Enums"]["final_outcome"] | null
          supplier_id: string | null
          updated_at: string
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
          order_id?: string | null
          overall_risk_rating?:
            | Database["public"]["Enums"]["risk_rating"]
            | null
          package: string
          product_category?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          suggested_outcome?:
            | Database["public"]["Enums"]["final_outcome"]
            | null
          supplier_id?: string | null
          updated_at?: string
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
          order_id?: string | null
          overall_risk_rating?:
            | Database["public"]["Enums"]["risk_rating"]
            | null
          package?: string
          product_category?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          suggested_outcome?:
            | Database["public"]["Enums"]["final_outcome"]
            | null
          supplier_id?: string | null
          updated_at?: string
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
      check_status:
        | "pass"
        | "caution"
        | "fail"
        | "not_verified"
        | "not_applicable"
      confidence_level: "high" | "medium_high" | "medium" | "low"
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
      ],
      check_status: [
        "pass",
        "caution",
        "fail",
        "not_verified",
        "not_applicable",
      ],
      confidence_level: ["high", "medium_high", "medium", "low"],
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
