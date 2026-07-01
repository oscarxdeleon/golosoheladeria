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
      branches: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
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
          slug: string | null
          ticket_footer: string | null
          ticket_header: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
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
          slug?: string | null
          ticket_footer?: string | null
          ticket_header?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
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
          slug?: string | null
          ticket_footer?: string | null
          ticket_header?: string | null
          updated_at?: string
        }
        Relationships: []
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
          name: string
          show_in_online_menu: boolean
          show_in_pos: boolean
          sort_order: number
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          id?: string
          name: string
          show_in_online_menu?: boolean
          show_in_pos?: boolean
          sort_order?: number
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          show_in_online_menu?: boolean
          show_in_pos?: boolean
          sort_order?: number
        }
        Relationships: []
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
      modifier_groups: {
        Row: {
          created_at: string
          id: string
          max_select: number
          min_select: number
          name: string
          required: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          max_select?: number
          min_select?: number
          name: string
          required?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          max_select?: number
          min_select?: number
          name?: string
          required?: boolean
        }
        Relationships: []
      }
      modifiers: {
        Row: {
          active: boolean
          group_id: string
          id: string
          name: string
          price: number
        }
        Insert: {
          active?: boolean
          group_id: string
          id?: string
          name: string
          price?: number
        }
        Update: {
          active?: boolean
          group_id?: string
          id?: string
          name?: string
          price?: number
        }
        Relationships: [
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
      printers: {
        Row: {
          active: boolean
          area: string
          created_at: string
          id: string
          ip: string | null
          name: string
          open_drawer_on_print: boolean
          platform: string
          port: number
        }
        Insert: {
          active?: boolean
          area?: string
          created_at?: string
          id?: string
          ip?: string | null
          name: string
          open_drawer_on_print?: boolean
          platform?: string
          port?: number
        }
        Update: {
          active?: boolean
          area?: string
          created_at?: string
          id?: string
          ip?: string | null
          name?: string
          open_drawer_on_print?: boolean
          platform?: string
          port?: number
        }
        Relationships: []
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
          min_stock: number
          modifier_group_ids: string[] | null
          name: string
          price: number
          recipe: Json
          show_in_online: boolean
          sku: string | null
          sold_by_weight: boolean
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
          min_stock?: number
          modifier_group_ids?: string[] | null
          name: string
          price?: number
          recipe?: Json
          show_in_online?: boolean
          sku?: string | null
          sold_by_weight?: boolean
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
          min_stock?: number
          modifier_group_ids?: string[] | null
          name?: string
          price?: number
          recipe?: Json
          show_in_online?: boolean
          sku?: string | null
          sold_by_weight?: boolean
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
          id: string
          modifiers: Json
          product_id: string | null
          product_name: string
          qty: number
          ready_at: string | null
          sale_id: string
          subtotal: number
          unit_price: number
        }
        Insert: {
          id?: string
          modifiers?: Json
          product_id?: string | null
          product_name: string
          qty?: number
          ready_at?: string | null
          sale_id: string
          subtotal?: number
          unit_price?: number
        }
        Update: {
          id?: string
          modifiers?: Json
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
          cash_session_id: string | null
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
          order_type: string
          payment_details: Json | null
          payment_method: string
          printed_at: string | null
          source: string
          status: string
          subtotal: number
          table_id: string | null
          tax: number
          ticket_number: number
          total: number
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          branch_id?: string | null
          cash_session_id?: string | null
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
          order_type?: string
          payment_details?: Json | null
          payment_method: string
          printed_at?: string | null
          source?: string
          status?: string
          subtotal?: number
          table_id?: string | null
          tax?: number
          ticket_number?: number
          total?: number
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          branch_id?: string | null
          cash_session_id?: string | null
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
          order_type?: string
          payment_details?: Json | null
          payment_method?: string
          printed_at?: string | null
          source?: string
          status?: string
          subtotal?: number
          table_id?: string | null
          tax?: number
          ticket_number?: number
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
          delivery_fee: number
          id: number
          local_print_url: string | null
          logo_url: string | null
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
          delivery_fee?: number
          id?: number
          local_print_url?: string | null
          logo_url?: string | null
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
          delivery_fee?: number
          id?: number
          local_print_url?: string | null
          logo_url?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      create_public_order: { Args: { _payload: Json }; Returns: Json }
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
      get_employee_current_state: {
        Args: { _employee_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
      release_table: {
        Args: { _reason: string; _table_id: string }
        Returns: Json
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
    }
    Enums: {
      app_role: "admin" | "cajero" | "mesero" | "domiciliario"
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
      app_role: ["admin", "cajero", "mesero", "domiciliario"],
    },
  },
} as const
