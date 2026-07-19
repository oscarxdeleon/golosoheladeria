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
      attendance_employees: {
        Row: {
          active: boolean
          branch_id: string | null
          created_at: string
          document_id: string | null
          email: string | null
          face_descriptor: Json | null
          full_name: string
          id: string
          job_position: string | null
          phone: string | null
          photo_url: string | null
          profile_id: string | null
          schedule: Json | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          document_id?: string | null
          email?: string | null
          face_descriptor?: Json | null
          full_name: string
          id?: string
          job_position?: string | null
          phone?: string | null
          photo_url?: string | null
          profile_id?: string | null
          schedule?: Json | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          document_id?: string | null
          email?: string | null
          face_descriptor?: Json | null
          full_name?: string
          id?: string
          job_position?: string | null
          phone?: string | null
          photo_url?: string | null
          profile_id?: string | null
          schedule?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_employees_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          address: string | null
          created_at: string
          device_info: Json | null
          employee_id: string
          face_match_score: number | null
          id: string
          lat: number | null
          lng: number | null
          notes: string | null
          photo_url: string | null
          record_type: string
          recorded_at: string
          terminal_id: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          device_info?: Json | null
          employee_id: string
          face_match_score?: number | null
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          photo_url?: string | null
          record_type: string
          recorded_at?: string
          terminal_id?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          device_info?: Json | null
          employee_id?: string
          face_match_score?: number | null
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          photo_url?: string | null
          record_type?: string
          recorded_at?: string
          terminal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "attendance_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "attendance_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_terminals: {
        Row: {
          active: boolean
          address: string | null
          authorized_lat: number | null
          authorized_lng: number | null
          authorized_radius_m: number | null
          branch_id: string | null
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          authorized_lat?: number | null
          authorized_lng?: number | null
          authorized_radius_m?: number | null
          branch_id?: string | null
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          authorized_lat?: number | null
          authorized_lng?: number | null
          authorized_radius_m?: number | null
          branch_id?: string | null
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_terminals_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          branch_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          meta: Json | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          branch_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          meta?: Json | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          branch_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          meta?: Json | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      branch_detection_log: {
        Row: {
          created_at: string
          detected_branch_id: string | null
          detection_method: string
          device_fingerprint: string | null
          error_message: string | null
          id: string
          probe_url: string | null
          success: boolean
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          detected_branch_id?: string | null
          detection_method: string
          device_fingerprint?: string | null
          error_message?: string | null
          id?: string
          probe_url?: string | null
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          detected_branch_id?: string | null
          detection_method?: string
          device_fingerprint?: string | null
          error_message?: string | null
          id?: string
          probe_url?: string | null
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_detection_log_detected_branch_id_fkey"
            columns: ["detected_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_print_settings: {
        Row: {
          branch_id: string
          cashier_printer_ip: string | null
          cashier_printer_port: number | null
          created_at: string
          id: string
          local_print_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id: string
          cashier_printer_ip?: string | null
          cashier_printer_port?: number | null
          created_at?: string
          id?: string
          local_print_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string
          cashier_printer_ip?: string | null
          cashier_printer_port?: number | null
          created_at?: string
          id?: string
          local_print_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_print_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          delivery_fee: number | null
          email: string | null
          id: string
          inherits_main_catalog: boolean
          is_main: boolean
          logo_url: string | null
          name: string
          neighborhood: string | null
          nit: string | null
          online_menu_url: string | null
          phone: string | null
          report_email: string | null
          report_whatsapp_numbers: Json
          schedules: Json
          slug: string | null
          ticket_footer: string | null
          ticket_header: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          delivery_fee?: number | null
          email?: string | null
          id?: string
          inherits_main_catalog?: boolean
          is_main?: boolean
          logo_url?: string | null
          name: string
          neighborhood?: string | null
          nit?: string | null
          online_menu_url?: string | null
          phone?: string | null
          report_email?: string | null
          report_whatsapp_numbers?: Json
          schedules?: Json
          slug?: string | null
          ticket_footer?: string | null
          ticket_header?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          delivery_fee?: number | null
          email?: string | null
          id?: string
          inherits_main_catalog?: boolean
          is_main?: boolean
          logo_url?: string | null
          name?: string
          neighborhood?: string | null
          nit?: string | null
          online_menu_url?: string | null
          phone?: string | null
          report_email?: string | null
          report_whatsapp_numbers?: Json
          schedules?: Json
          slug?: string | null
          ticket_footer?: string | null
          ticket_header?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cash_deposits: {
        Row: {
          amount: number
          branch_id: string | null
          cash_session_id: string
          created_at: string
          description: string
          device: string | null
          id: string
          method: string
          status: string
          updated_at: string
          user_id: string
          user_name: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cash_session_id: string
          created_at?: string
          description: string
          device?: string | null
          id?: string
          method: string
          status?: string
          updated_at?: string
          user_id: string
          user_name?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cash_session_id?: string
          created_at?: string
          description?: string
          device?: string | null
          id?: string
          method?: string
          status?: string
          updated_at?: string
          user_id?: string
          user_name?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_deposits_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_deposits_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          bancolombia_counted: number | null
          bancolombia_difference: number | null
          bancolombia_expected: number | null
          branch_id: string | null
          cash_counted: number | null
          cash_difference: number | null
          cash_expected: number | null
          closed_at: string | null
          closing_notes: string | null
          counted_amount: number | null
          created_at: string
          difference: number | null
          expected_amount: number | null
          id: string
          nequi_counted: number | null
          nequi_difference: number | null
          nequi_expected: number | null
          opened_at: string
          opening_amount: number
          opening_notes: string | null
          status: string
          user_id: string
          user_name: string
        }
        Insert: {
          bancolombia_counted?: number | null
          bancolombia_difference?: number | null
          bancolombia_expected?: number | null
          branch_id?: string | null
          cash_counted?: number | null
          cash_difference?: number | null
          cash_expected?: number | null
          closed_at?: string | null
          closing_notes?: string | null
          counted_amount?: number | null
          created_at?: string
          difference?: number | null
          expected_amount?: number | null
          id?: string
          nequi_counted?: number | null
          nequi_difference?: number | null
          nequi_expected?: number | null
          opened_at?: string
          opening_amount?: number
          opening_notes?: string | null
          status?: string
          user_id: string
          user_name: string
        }
        Update: {
          bancolombia_counted?: number | null
          bancolombia_difference?: number | null
          bancolombia_expected?: number | null
          branch_id?: string | null
          cash_counted?: number | null
          cash_difference?: number | null
          cash_expected?: number | null
          closed_at?: string | null
          closing_notes?: string | null
          counted_amount?: number | null
          created_at?: string
          difference?: number | null
          expected_amount?: number | null
          id?: string
          nequi_counted?: number | null
          nequi_difference?: number | null
          nequi_expected?: number | null
          opened_at?: string
          opening_amount?: number
          opening_notes?: string | null
          status?: string
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          id: string
          kiosk_sort_order: number
          name: string
          online_sort_order: number
          show_in_online_menu: boolean
          show_in_pos: boolean
          sort_order: number
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          id?: string
          kiosk_sort_order?: number
          name: string
          online_sort_order?: number
          show_in_online_menu?: boolean
          show_in_pos?: boolean
          sort_order?: number
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          id?: string
          kiosk_sort_order?: number
          name?: string
          online_sort_order?: number
          show_in_online_menu?: boolean
          show_in_pos?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      couriers: {
        Row: {
          active: boolean
          branch_id: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "couriers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_payments: {
        Row: {
          amount: number
          branch_id: string | null
          cash_session_id: string | null
          created_at: string
          credit_id: string
          customer_id: string | null
          id: string
          notes: string | null
          payment_method: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cash_session_id?: string | null
          created_at?: string
          credit_id: string
          customer_id?: string | null
          id?: string
          notes?: string | null
          payment_method?: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cash_session_id?: string | null
          created_at?: string
          credit_id?: string
          customer_id?: string | null
          id?: string
          notes?: string | null
          payment_method?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_payments_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_payments_credit_id_fkey"
            columns: ["credit_id"]
            isOneToOne: false
            referencedRelation: "credits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      credits: {
        Row: {
          balance: number
          branch_id: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          customer_id: string
          id: string
          notes: string | null
          sale_id: string | null
          status: string
          ticket_number: number | null
          total: number
          updated_at: string
        }
        Insert: {
          balance: number
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_id: string
          id?: string
          notes?: string | null
          sale_id?: string | null
          status?: string
          ticket_number?: number | null
          total: number
          updated_at?: string
        }
        Update: {
          balance?: number
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_id?: string
          id?: string
          notes?: string | null
          sale_id?: string | null
          status?: string
          ticket_number?: number | null
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credits_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          address: string
          created_at: string
          customer_id: string
          id: string
          is_default: boolean
          label: string
          neighborhood: string | null
          phone: string | null
          reference: string | null
          updated_at: string
        }
        Insert: {
          address: string
          created_at?: string
          customer_id: string
          id?: string
          is_default?: boolean
          label?: string
          neighborhood?: string | null
          phone?: string | null
          reference?: string | null
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          customer_id?: string
          id?: string
          is_default?: boolean
          label?: string
          neighborhood?: string | null
          phone?: string | null
          reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          frequent_channel: string | null
          id: string
          last_order_at: string | null
          name: string
          neighborhood: string | null
          notes: string | null
          phone: string | null
          points: number
          total_orders: number
          total_spent: number
          updated_at: string
          visits: number
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          frequent_channel?: string | null
          id?: string
          last_order_at?: string | null
          name: string
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          points?: number
          total_orders?: number
          total_spent?: number
          updated_at?: string
          visits?: number
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          frequent_channel?: string | null
          id?: string
          last_order_at?: string | null
          name?: string
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          points?: number
          total_orders?: number
          total_spent?: number
          updated_at?: string
          visits?: number
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          active: boolean
          branch_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          branch_id: string | null
          cash_session_id: string | null
          category: string
          created_at: string
          description: string
          id: string
          payment_method: string
          receipt_url: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cash_session_id?: string | null
          category: string
          created_at?: string
          description: string
          id?: string
          payment_method?: string
          receipt_url?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cash_session_id?: string | null
          category?: string
          created_at?: string
          description?: string
          id?: string
          payment_method?: string
          receipt_url?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      failed_login_attempts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          ip: string | null
          reason: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          ip?: string | null
          reason?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          ip?: string | null
          reason?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string
          id: string
          item_type: string
          movement_type: string
          product_id: string | null
          quantity: number
          reason: string | null
          supply_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_type: string
          movement_type: string
          product_id?: string | null
          quantity: number
          reason?: string | null
          supply_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          item_type?: string
          movement_type?: string
          product_id?: string | null
          quantity?: number
          reason?: string | null
          supply_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_supply_id_fkey"
            columns: ["supply_id"]
            isOneToOne: false
            referencedRelation: "supplies"
            referencedColumns: ["id"]
          },
        ]
      }
      kiosk_feedback: {
        Row: {
          branch_id: string | null
          created_at: string
          id: string
          rating: number
          sale_id: string | null
          source: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          id?: string
          rating: number
          sale_id?: string | null
          source?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          id?: string
          rating?: number
          sale_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "kiosk_feedback_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kiosk_feedback_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          branch_id: string
          created_at: string
          id: string
          max_select: number
          min_select: number
          name: string
          origin_group_id: string | null
          required: boolean
        }
        Insert: {
          branch_id: string
          created_at?: string
          id?: string
          max_select?: number
          min_select?: number
          name: string
          origin_group_id?: string | null
          required?: boolean
        }
        Update: {
          branch_id?: string
          created_at?: string
          id?: string
          max_select?: number
          min_select?: number
          name?: string
          origin_group_id?: string | null
          required?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "modifier_groups_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      modifiers: {
        Row: {
          active: boolean
          branch_id: string
          disabled_branch_ids: string[]
          group_id: string
          id: string
          image_url: string | null
          name: string
          price: number
        }
        Insert: {
          active?: boolean
          branch_id: string
          disabled_branch_ids?: string[]
          group_id: string
          id?: string
          image_url?: string | null
          name: string
          price?: number
        }
        Update: {
          active?: boolean
          branch_id?: string
          disabled_branch_ids?: string[]
          group_id?: string
          id?: string
          image_url?: string | null
          name?: string
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "modifiers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifiers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          active: boolean
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      print_jobs: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          payload: Json
          printed_at: string | null
          sale_id: string | null
          status: string
          tries: number
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          payload: Json
          printed_at?: string | null
          sale_id?: string | null
          status?: string
          tries?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          payload?: Json
          printed_at?: string | null
          sale_id?: string | null
          status?: string
          tries?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      printers: {
        Row: {
          active: boolean
          area: string
          branch_id: string | null
          created_at: string
          drawer_master_enabled: boolean
          drawer_on_cash_close: boolean
          drawer_on_cash_deposit: boolean
          drawer_on_cash_expense: boolean
          drawer_on_cash_open: boolean
          drawer_on_cash_sale: boolean
          id: string
          ip: string | null
          local_url: string | null
          name: string
          open_drawer_on_print: boolean
          platform: string
          port: number
        }
        Insert: {
          active?: boolean
          area?: string
          branch_id?: string | null
          created_at?: string
          drawer_master_enabled?: boolean
          drawer_on_cash_close?: boolean
          drawer_on_cash_deposit?: boolean
          drawer_on_cash_expense?: boolean
          drawer_on_cash_open?: boolean
          drawer_on_cash_sale?: boolean
          id?: string
          ip?: string | null
          local_url?: string | null
          name: string
          open_drawer_on_print?: boolean
          platform?: string
          port?: number
        }
        Update: {
          active?: boolean
          area?: string
          branch_id?: string | null
          created_at?: string
          drawer_master_enabled?: boolean
          drawer_on_cash_close?: boolean
          drawer_on_cash_deposit?: boolean
          drawer_on_cash_expense?: boolean
          drawer_on_cash_open?: boolean
          drawer_on_cash_sale?: boolean
          id?: string
          ip?: string | null
          local_url?: string | null
          name?: string
          open_drawer_on_print?: boolean
          platform?: string
          port?: number
        }
        Relationships: [
          {
            foreignKeyName: "printers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          allow_negative_stock: boolean
          available_branch_ids: string[] | null
          category_id: string | null
          created_at: string
          id: string
          image_url: string | null
          is_favorite: boolean
          is_linked: boolean
          min_stock: number
          modifier_group_ids: string[] | null
          name: string
          price: number
          recipe: Json
          show_in_online: boolean
          sku: string | null
          sold_by_weight: boolean
          source_product_id: string | null
          stock: number
          track_stock: boolean
        }
        Insert: {
          active?: boolean
          allow_negative_stock?: boolean
          available_branch_ids?: string[] | null
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_favorite?: boolean
          is_linked?: boolean
          min_stock?: number
          modifier_group_ids?: string[] | null
          name: string
          price?: number
          recipe?: Json
          show_in_online?: boolean
          sku?: string | null
          sold_by_weight?: boolean
          source_product_id?: string | null
          stock?: number
          track_stock?: boolean
        }
        Update: {
          active?: boolean
          allow_negative_stock?: boolean
          available_branch_ids?: string[] | null
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_favorite?: boolean
          is_linked?: boolean
          min_stock?: number
          modifier_group_ids?: string[] | null
          name?: string
          price?: number
          recipe?: Json
          show_in_online?: boolean
          sku?: string | null
          sold_by_weight?: boolean
          source_product_id?: string | null
          stock?: number
          track_stock?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_source_product_id_fkey"
            columns: ["source_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          branch_id: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
        }
        Insert: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id: string
        }
        Update: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_items: {
        Row: {
          created_at: string
          id: string
          item_name: string
          item_type: string
          product_id: string | null
          purchase_id: string
          quantity: number
          subtotal: number
          supply_id: string | null
          unit_cost: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_name: string
          item_type: string
          product_id?: string | null
          purchase_id: string
          quantity: number
          subtotal?: number
          supply_id?: string | null
          unit_cost?: number
        }
        Update: {
          created_at?: string
          id?: string
          item_name?: string
          item_type?: string
          product_id?: string | null
          purchase_id?: string
          quantity?: number
          subtotal?: number
          supply_id?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_supply_id_fkey"
            columns: ["supply_id"]
            isOneToOne: false
            referencedRelation: "supplies"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          branch_id: string | null
          cash_session_id: string | null
          created_at: string
          id: string
          invoice_number: string | null
          notes: string | null
          payment_method: string
          supplier: string | null
          total: number
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          branch_id?: string | null
          cash_session_id?: string | null
          created_at?: string
          id?: string
          invoice_number?: string | null
          notes?: string | null
          payment_method?: string
          supplier?: string | null
          total?: number
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          branch_id?: string | null
          cash_session_id?: string | null
          created_at?: string
          id?: string
          invoice_number?: string | null
          notes?: string | null
          payment_method?: string
          supplier?: string | null
          total?: number
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_tables: {
        Row: {
          active: boolean
          branch_id: string | null
          created_at: string
          current_guests: number | null
          id: string
          label: string | null
          merged_at: string | null
          merged_into_id: string | null
          notes: string | null
          number: number
          occupied_at: string | null
          pos_x: number
          pos_y: number
          room_id: string | null
          seats: number
          status: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          current_guests?: number | null
          id?: string
          label?: string | null
          merged_at?: string | null
          merged_into_id?: string | null
          notes?: string | null
          number: number
          occupied_at?: string | null
          pos_x?: number
          pos_y?: number
          room_id?: string | null
          seats?: number
          status?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          current_guests?: number | null
          id?: string
          label?: string | null
          merged_at?: string | null
          merged_into_id?: string | null
          notes?: string | null
          number?: number
          occupied_at?: string | null
          pos_x?: number
          pos_y?: number
          room_id?: string | null
          seats?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_tables_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_tables_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_tables_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          route_key: string
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          route_key: string
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          route_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          active: boolean
          branch_id: string | null
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          branch_id: string | null
          id: string
          modifiers: Json
          notes: string | null
          origin_table_id: string | null
          product_id: string | null
          product_name: string
          qty: number
          ready_at: string | null
          sale_id: string
          subtotal: number
          unit_price: number
        }
        Insert: {
          branch_id?: string | null
          id?: string
          modifiers?: Json
          notes?: string | null
          origin_table_id?: string | null
          product_id?: string | null
          product_name: string
          qty?: number
          ready_at?: string | null
          sale_id: string
          subtotal?: number
          unit_price?: number
        }
        Update: {
          branch_id?: string | null
          id?: string
          modifiers?: Json
          notes?: string | null
          origin_table_id?: string | null
          product_id?: string | null
          product_name?: string
          qty?: number
          ready_at?: string | null
          sale_id?: string
          subtotal?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_origin_table_id_fkey"
            columns: ["origin_table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          branch_id: string | null
          cancellation_previous_status: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_name: string | null
          cash_session_id: string | null
          courier_id: string | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          delivery_address: string | null
          delivery_fee: number
          delivery_neighborhood: string | null
          delivery_phone: string | null
          delivery_status: string | null
          delivery_user_id: string | null
          id: string
          kds_ack_at: string | null
          notes: string | null
          notify_ack_at: string | null
          order_type: string
          payment_details: Json | null
          payment_method: string
          printed_at: string | null
          scheduled_for: string | null
          source: string
          status: string
          subtotal: number
          table_id: string | null
          tax: number
          ticket_number: number
          tip_amount: number
          total: number
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          branch_id?: string | null
          cancellation_previous_status?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_name?: string | null
          cash_session_id?: string | null
          courier_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          delivery_neighborhood?: string | null
          delivery_phone?: string | null
          delivery_status?: string | null
          delivery_user_id?: string | null
          id?: string
          kds_ack_at?: string | null
          notes?: string | null
          notify_ack_at?: string | null
          order_type?: string
          payment_details?: Json | null
          payment_method: string
          printed_at?: string | null
          scheduled_for?: string | null
          source?: string
          status?: string
          subtotal?: number
          table_id?: string | null
          tax?: number
          ticket_number?: number
          tip_amount?: number
          total?: number
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          branch_id?: string | null
          cancellation_previous_status?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_name?: string | null
          cash_session_id?: string | null
          courier_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          delivery_neighborhood?: string | null
          delivery_phone?: string | null
          delivery_status?: string | null
          delivery_user_id?: string | null
          id?: string
          kds_ack_at?: string | null
          notes?: string | null
          notify_ack_at?: string | null
          order_type?: string
          payment_details?: Json | null
          payment_method?: string
          printed_at?: string | null
          scheduled_for?: string | null
          source?: string
          status?: string
          subtotal?: number
          table_id?: string | null
          tax?: number
          ticket_number?: number
          tip_amount?: number
          total?: number
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_courier_id_fkey"
            columns: ["courier_id"]
            isOneToOne: false
            referencedRelation: "couriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          address: string | null
          bancolombia_account: string | null
          business_name: string
          cashier_printer_ip: string | null
          cashier_printer_port: number | null
          city: string | null
          command_format_active: string
          command_formats: Json
          delivery_fee: number
          enable_tips: boolean
          id: number
          local_print_url: string | null
          logo_url: string | null
          loyalty_enabled: boolean
          loyalty_expiration_days: number
          loyalty_min_redeem: number
          loyalty_point_value: number
          loyalty_points_per_1000: number
          loyalty_welcome_text: string | null
          menu_link: string | null
          nequi_number: string | null
          nit: string | null
          phone: string | null
          schedules: Json
          tax_rate: number
          ticket_config: Json
          ticket_footer: string | null
          ticket_header: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          bancolombia_account?: string | null
          business_name?: string
          cashier_printer_ip?: string | null
          cashier_printer_port?: number | null
          city?: string | null
          command_format_active?: string
          command_formats?: Json
          delivery_fee?: number
          enable_tips?: boolean
          id?: number
          local_print_url?: string | null
          logo_url?: string | null
          loyalty_enabled?: boolean
          loyalty_expiration_days?: number
          loyalty_min_redeem?: number
          loyalty_point_value?: number
          loyalty_points_per_1000?: number
          loyalty_welcome_text?: string | null
          menu_link?: string | null
          nequi_number?: string | null
          nit?: string | null
          phone?: string | null
          schedules?: Json
          tax_rate?: number
          ticket_config?: Json
          ticket_footer?: string | null
          ticket_header?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          bancolombia_account?: string | null
          business_name?: string
          cashier_printer_ip?: string | null
          cashier_printer_port?: number | null
          city?: string | null
          command_format_active?: string
          command_formats?: Json
          delivery_fee?: number
          enable_tips?: boolean
          id?: number
          local_print_url?: string | null
          logo_url?: string | null
          loyalty_enabled?: boolean
          loyalty_expiration_days?: number
          loyalty_min_redeem?: number
          loyalty_point_value?: number
          loyalty_points_per_1000?: number
          loyalty_welcome_text?: string | null
          menu_link?: string | null
          nequi_number?: string | null
          nit?: string | null
          phone?: string | null
          schedules?: Json
          tax_rate?: number
          ticket_config?: Json
          ticket_footer?: string | null
          ticket_header?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      supplier_credit_payments: {
        Row: {
          amount: number
          branch_id: string | null
          cash_session_id: string | null
          created_at: string
          id: string
          notes: string | null
          payment_method: string
          supplier_credit_id: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cash_session_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          payment_method?: string
          supplier_credit_id: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cash_session_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          payment_method?: string
          supplier_credit_id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_credit_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_credit_payments_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_credit_payments_supplier_credit_id_fkey"
            columns: ["supplier_credit_id"]
            isOneToOne: false
            referencedRelation: "supplier_credits"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_credits: {
        Row: {
          balance: number
          branch_id: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          invoice_number: string | null
          notes: string | null
          purchase_id: string | null
          status: string
          supplier: string
          total: number
          updated_at: string
        }
        Insert: {
          balance: number
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          invoice_number?: string | null
          notes?: string | null
          purchase_id?: string | null
          status?: string
          supplier?: string
          total: number
          updated_at?: string
        }
        Update: {
          balance?: number
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          invoice_number?: string | null
          notes?: string | null
          purchase_id?: string | null
          status?: string
          supplier?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_credits_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_credits_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      supplies: {
        Row: {
          cost: number
          created_at: string
          id: string
          min_stock: number
          name: string
          stock: number
          unit: string
        }
        Insert: {
          cost?: number
          created_at?: string
          id?: string
          min_stock?: number
          name: string
          stock?: number
          unit?: string
        }
        Update: {
          cost?: number
          created_at?: string
          id?: string
          min_stock?: number
          name?: string
          stock?: number
          unit?: string
        }
        Relationships: []
      }
      table_events: {
        Row: {
          branch_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          new_status: string | null
          previous_status: string | null
          reason: string | null
          sale_id: string | null
          table_id: string | null
          table_number: number | null
          target_table_id: string | null
          target_table_number: number | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          new_status?: string | null
          previous_status?: string | null
          reason?: string | null
          sale_id?: string | null
          table_id?: string | null
          table_number?: number | null
          target_table_id?: string | null
          target_table_number?: number | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          new_status?: string | null
          previous_status?: string | null
          reason?: string | null
          sale_id?: string | null
          table_id?: string | null
          table_number?: number | null
          target_table_id?: string | null
          target_table_number?: number | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "table_events_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_events_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_events_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_events_target_table_id_fkey"
            columns: ["target_table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      tablet_devices: {
        Row: {
          active: boolean
          branch_id: string
          created_at: string
          email: string
          id: string
          label: string
          last_seen_at: string | null
          password: string
          token: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          branch_id: string
          created_at?: string
          email: string
          id?: string
          label: string
          last_seen_at?: string | null
          password: string
          token: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          branch_id?: string
          created_at?: string
          email?: string
          id?: string
          label?: string
          last_seen_at?: string | null
          password?: string
          token?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tablet_devices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waiter_calls: {
        Row: {
          attended_at: string | null
          attended_by: string | null
          attended_by_name: string | null
          branch_id: string | null
          created_at: string
          id: string
          reason: string | null
          status: string
          table_id: string | null
          table_label: string | null
          table_number: number | null
        }
        Insert: {
          attended_at?: string | null
          attended_by?: string | null
          attended_by_name?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          status?: string
          table_id?: string | null
          table_label?: string | null
          table_number?: number | null
        }
        Update: {
          attended_at?: string | null
          attended_by?: string | null
          attended_by_name?: string | null
          branch_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          status?: string
          table_id?: string | null
          table_label?: string | null
          table_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "waiter_calls_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_bot_config: {
        Row: {
          after_hours_enabled: boolean
          after_hours_messages: string[]
          branch_id: string
          connected_phone: string | null
          connection_status: string
          created_at: string
          device_token: string
          enabled: boolean
          last_seen_at: string | null
          menu_message: string
          menu_triggers: string[]
          pickup_after_hours_enabled: boolean
          pickup_after_hours_messages: string[]
          qr_code: string | null
          qr_generated_at: string | null
          updated_at: string
          welcome_messages: string[]
        }
        Insert: {
          after_hours_enabled?: boolean
          after_hours_messages?: string[]
          branch_id: string
          connected_phone?: string | null
          connection_status?: string
          created_at?: string
          device_token?: string
          enabled?: boolean
          last_seen_at?: string | null
          menu_message?: string
          menu_triggers?: string[]
          pickup_after_hours_enabled?: boolean
          pickup_after_hours_messages?: string[]
          qr_code?: string | null
          qr_generated_at?: string | null
          updated_at?: string
          welcome_messages?: string[]
        }
        Update: {
          after_hours_enabled?: boolean
          after_hours_messages?: string[]
          branch_id?: string
          connected_phone?: string | null
          connection_status?: string
          created_at?: string
          device_token?: string
          enabled?: boolean
          last_seen_at?: string | null
          menu_message?: string
          menu_triggers?: string[]
          pickup_after_hours_enabled?: boolean
          pickup_after_hours_messages?: string[]
          qr_code?: string | null
          qr_generated_at?: string | null
          updated_at?: string
          welcome_messages?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_bot_config_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_bot_greeted: {
        Row: {
          branch_id: string
          greeted_date: string
          phone: string
        }
        Insert: {
          branch_id: string
          greeted_date?: string
          phone: string
        }
        Update: {
          branch_id?: string
          greeted_date?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_bot_greeted_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_bot_messages: {
        Row: {
          body: string | null
          branch_id: string
          direction: string
          from_number: string
          id: string
          matched_trigger: string | null
          received_at: string
        }
        Insert: {
          body?: string | null
          branch_id: string
          direction: string
          from_number: string
          id?: string
          matched_trigger?: string | null
          received_at?: string
        }
        Update: {
          body?: string | null
          branch_id?: string
          direction?: string
          from_number?: string
          id?: string
          matched_trigger?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_bot_messages_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_outbound_queue: {
        Row: {
          attempts: number
          body: string
          branch_id: string
          created_at: string
          id: string
          last_error: string | null
          purpose: string
          sent_at: string | null
          status: string
          to_phone: string
        }
        Insert: {
          attempts?: number
          body: string
          branch_id: string
          created_at?: string
          id?: string
          last_error?: string | null
          purpose?: string
          sent_at?: string | null
          status?: string
          to_phone: string
        }
        Update: {
          attempts?: number
          body?: string
          branch_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          purpose?: string
          sent_at?: string | null
          status?: string
          to_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_outbound_queue_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _normalize_payment_method: { Args: { _m: string }; Returns: string }
      _shared_cash_session_detail: {
        Args: { _cash_session_id: string }
        Returns: Json
      }
      _shared_cash_session_list: {
        Args: {
          _branch_id: string
          _from?: string
          _status?: string
          _to?: string
        }
        Returns: Json
      }
      _shared_dashboard_payload: {
        Args: {
          _branch_id: string
          _end: string
          _origen?: string
          _pago?: string
          _start: string
        }
        Returns: Json
      }
      admin_cash_session_detail_rpc: {
        Args: { _cash_session_id: string }
        Returns: Json
      }
      admin_cash_sessions_list_rpc: {
        Args: {
          _branch_id: string
          _from?: string
          _status?: string
          _to?: string
        }
        Returns: Json
      }
      admin_create_app_user: {
        Args: {
          _active?: boolean
          _branch_id?: string
          _email: string
          _full_name: string
          _password: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      admin_dashboard_rpc: {
        Args: {
          _branch_id: string
          _origen?: string
          _pago?: string
          _range?: string
        }
        Returns: Json
      }
      admin_delete_app_user: { Args: { _user_id: string }; Returns: undefined }
      admin_release_deleted_user_email: {
        Args: { _email?: string; _user_id: string }
        Returns: undefined
      }
      admin_update_app_user: {
        Args: {
          _active?: boolean
          _branch_id?: string
          _branch_id_set?: boolean
          _full_name?: string
          _password?: string
          _role?: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      assert_current_user_is_admin: { Args: never; Returns: string }
      attend_waiter_call: { Args: { _call_id: string }; Returns: Json }
      cancel_sale: {
        Args: { _reason: string; _sale_id: string }
        Returns: Json
      }
      clone_main_products_to_branch: {
        Args: { _branch_id: string }
        Returns: Json
      }
      close_cash_session: {
        Args: { _closing_notes?: string; _counted_amount: number }
        Returns: {
          bancolombia_counted: number | null
          bancolombia_difference: number | null
          bancolombia_expected: number | null
          branch_id: string | null
          cash_counted: number | null
          cash_difference: number | null
          cash_expected: number | null
          closed_at: string | null
          closing_notes: string | null
          counted_amount: number | null
          created_at: string
          difference: number | null
          expected_amount: number | null
          id: string
          nequi_counted: number | null
          nequi_difference: number | null
          nequi_expected: number | null
          opened_at: string
          opening_amount: number
          opening_notes: string | null
          status: string
          user_id: string
          user_name: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_cash_session_blind: {
        Args: {
          _bancolombia_counted: number
          _branch_id?: string
          _cash_counted: number
          _closing_notes?: string
          _nequi_counted: number
        }
        Returns: {
          bancolombia_counted: number | null
          bancolombia_difference: number | null
          bancolombia_expected: number | null
          branch_id: string | null
          cash_counted: number | null
          cash_difference: number | null
          cash_expected: number | null
          closed_at: string | null
          closing_notes: string | null
          counted_amount: number | null
          created_at: string
          difference: number | null
          expected_amount: number | null
          id: string
          nequi_counted: number | null
          nequi_difference: number | null
          nequi_expected: number | null
          opened_at: string
          opening_amount: number
          opening_notes: string | null
          status: string
          user_id: string
          user_name: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consolidate_active_sales_for_table: {
        Args: { _table_id: string }
        Returns: string
      }
      create_public_order: { Args: { _payload: Json }; Returns: Json }
      create_waiter_call: {
        Args: { _reason?: string; _table_id: string }
        Returns: Json
      }
      get_active_cash_session: {
        Args: { _branch_id?: string }
        Returns: {
          bancolombia_counted: number | null
          bancolombia_difference: number | null
          bancolombia_expected: number | null
          branch_id: string | null
          cash_counted: number | null
          cash_difference: number | null
          cash_expected: number | null
          closed_at: string | null
          closing_notes: string | null
          counted_amount: number | null
          created_at: string
          difference: number | null
          expected_amount: number | null
          id: string
          nequi_counted: number | null
          nequi_difference: number | null
          nequi_expected: number | null
          opened_at: string
          opening_amount: number
          opening_notes: string | null
          status: string
          user_id: string
          user_name: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_customer_by_phone: { Args: { _phone: string }; Returns: Json }
      get_employee_current_state: {
        Args: { _employee_id: string }
        Returns: string
      }
      get_tablet_credentials: {
        Args: { _token: string }
        Returns: {
          branch_name: string
          branch_slug: string
          email: string
          password: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      kds_public_mark_all_ready: {
        Args: { p_sale_id: string }
        Returns: undefined
      }
      kds_public_mark_item_ready: {
        Args: { p_item_id: string }
        Returns: undefined
      }
      kds_public_pending: { Args: { p_slug: string }; Returns: Json }
      log_failed_login: {
        Args: {
          _email: string
          _ip?: string
          _reason?: string
          _user_agent?: string
        }
        Returns: undefined
      }
      log_reimpression: {
        Args: { _kind?: string; _reason?: string; _sale_id: string }
        Returns: Json
      }
      lookup_customer_loyalty: { Args: { _phone: string }; Returns: Json }
      merge_tables: {
        Args: { _principal_id: string; _reason?: string; _source_ids: string[] }
        Returns: Json
      }
      move_table: {
        Args: {
          _force?: boolean
          _from_table_id: string
          _reason?: string
          _to_table_id: string
        }
        Returns: Json
      }
      open_cash_session: {
        Args: {
          _branch_id?: string
          _opening_amount: number
          _opening_notes?: string
          _user_name?: string
        }
        Returns: {
          bancolombia_counted: number | null
          bancolombia_difference: number | null
          bancolombia_expected: number | null
          branch_id: string | null
          cash_counted: number | null
          cash_difference: number | null
          cash_expected: number | null
          closed_at: string | null
          closing_notes: string | null
          counted_amount: number | null
          created_at: string
          difference: number | null
          expected_amount: number | null
          id: string
          nequi_counted: number | null
          nequi_difference: number | null
          nequi_expected: number | null
          opened_at: string
          opening_amount: number
          opening_notes: string | null
          status: string
          user_id: string
          user_name: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reconcile_restaurant_tables: {
        Args: { _branch_id?: string }
        Returns: Json
      }
      register_credit_payment: {
        Args: {
          _amount: number
          _cash_session_id?: string
          _credit_id: string
          _method?: string
          _notes?: string
        }
        Returns: Json
      }
      register_supplier_payment: {
        Args: {
          _amount: number
          _cash_session_id?: string
          _method?: string
          _notes?: string
          _supplier_credit_id: string
        }
        Returns: Json
      }
      release_table: {
        Args: { _reason: string; _table_id: string }
        Returns: Json
      }
      release_table_if_no_active_sales: {
        Args: { _reason?: string; _sale_id?: string; _table_id: string }
        Returns: boolean
      }
      replace_sale_items: {
        Args: { _items: Json; _sale_id: string }
        Returns: Json
      }
      resync_product_from_parent: {
        Args: { _child_id: string }
        Returns: undefined
      }
      sale_involves_cash: {
        Args: { _details: Json; _method: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      split_merged_tables: {
        Args: { _principal_id: string; _reason?: string }
        Returns: Json
      }
      sync_active_cash_session: {
        Args: { _branch_id?: string; _user_name?: string }
        Returns: {
          bancolombia_counted: number | null
          bancolombia_difference: number | null
          bancolombia_expected: number | null
          branch_id: string | null
          cash_counted: number | null
          cash_difference: number | null
          cash_expected: number | null
          closed_at: string | null
          closing_notes: string | null
          counted_amount: number | null
          created_at: string
          difference: number | null
          expected_amount: number | null
          id: string
          nequi_counted: number | null
          nequi_difference: number | null
          nequi_expected: number | null
          opened_at: string
          opening_amount: number
          opening_notes: string | null
          status: string
          user_id: string
          user_name: string
        }
        SetofOptions: {
          from: "*"
          to: "cash_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      terminal_list_employees: {
        Args: { _slug: string }
        Returns: {
          branch_id: string
          document_id: string
          face_descriptor: Json
          full_name: string
          id: string
          job_position: string
          photo_url: string
          terminal_id: string
          terminal_name: string
        }[]
      }
      terminal_record_attendance: { Args: { _payload: Json }; Returns: Json }
      touch_tablet_last_seen: { Args: { _token: string }; Returns: undefined }
      whatsapp_bot_ack_outbound: {
        Args: {
          _error?: string
          _failed: string[]
          _sent: string[]
          _token: string
        }
        Returns: Json
      }
      whatsapp_bot_get_config: { Args: { _token: string }; Returns: Json }
      whatsapp_bot_get_pending: { Args: { _token: string }; Returns: Json }
      whatsapp_bot_handle_incoming: {
        Args: { _body: string; _from: string; _token: string }
        Returns: Json
      }
      whatsapp_bot_is_online_open: {
        Args: { _branch_id: string }
        Returns: boolean
      }
      whatsapp_bot_is_physical_open: {
        Args: { _branch_id: string }
        Returns: boolean
      }
      whatsapp_bot_report_status: {
        Args: { _phone?: string; _qr?: string; _status: string; _token: string }
        Returns: Json
      }
      whatsapp_bot_resolve_branch_id: {
        Args: { _token: string }
        Returns: string
      }
      whatsapp_bot_rotate_token: {
        Args: { _branch_id: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "cajero" | "mesero" | "domiciliario" | "supervisor"
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
      app_role: ["admin", "cajero", "mesero", "domiciliario", "supervisor"],
    },
  },
} as const
