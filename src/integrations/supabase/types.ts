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
      branches: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          id: string
          inherits_main_catalog: boolean
          is_main: boolean
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          inherits_main_catalog?: boolean
          is_main?: boolean
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          inherits_main_catalog?: boolean
          is_main?: boolean
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cash_sessions: {
        Row: {
          closed_at: string | null
          closing_notes: string | null
          counted_amount: number | null
          created_at: string
          difference: number | null
          expected_amount: number | null
          id: string
          opened_at: string
          opening_amount: number
          opening_notes: string | null
          status: string
          user_id: string
          user_name: string
        }
        Insert: {
          closed_at?: string | null
          closing_notes?: string | null
          counted_amount?: number | null
          created_at?: string
          difference?: number | null
          expected_amount?: number | null
          id?: string
          opened_at?: string
          opening_amount?: number
          opening_notes?: string | null
          status?: string
          user_id: string
          user_name: string
        }
        Update: {
          closed_at?: string | null
          closing_notes?: string | null
          counted_amount?: number | null
          created_at?: string
          difference?: number | null
          expected_amount?: number | null
          id?: string
          opened_at?: string
          opening_amount?: number
          opening_notes?: string | null
          status?: string
          user_id?: string
          user_name?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
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
          ip: string
          name: string
          platform: string
          port: number
        }
        Insert: {
          active?: boolean
          area?: string
          created_at?: string
          id?: string
          ip: string
          name: string
          platform?: string
          port?: number
        }
        Update: {
          active?: boolean
          area?: string
          created_at?: string
          id?: string
          ip?: string
          name?: string
          platform?: string
          port?: number
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          category_id: string | null
          created_at: string
          id: string
          image_url: string | null
          min_stock: number
          name: string
          price: number
          sku: string | null
          stock: number
          track_stock: boolean
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          min_stock?: number
          name: string
          price?: number
          sku?: string | null
          stock?: number
          track_stock?: boolean
        }
        Update: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          min_stock?: number
          name?: string
          price?: number
          sku?: string | null
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
          created_at: string
          full_name: string
          id: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
        }
        Relationships: []
      }
      restaurant_tables: {
        Row: {
          active: boolean
          created_at: string
          current_guests: number | null
          id: string
          label: string | null
          notes: string | null
          number: number
          occupied_at: string | null
          pos_x: number
          pos_y: number
          seats: number
          status: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          current_guests?: number | null
          id?: string
          label?: string | null
          notes?: string | null
          number: number
          occupied_at?: string | null
          pos_x?: number
          pos_y?: number
          seats?: number
          status?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          current_guests?: number | null
          id?: string
          label?: string | null
          notes?: string | null
          number?: number
          occupied_at?: string | null
          pos_x?: number
          pos_y?: number
          seats?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          id: string
          modifiers: Json
          product_id: string | null
          product_name: string
          qty: number
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
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          delivery_address: string | null
          delivery_fee: number
          delivery_phone: string | null
          id: string
          kds_ack_at: string | null
          notes: string | null
          order_type: string
          payment_method: string
          printed_at: string | null
          source: string
          status: string
          subtotal: number
          table_id: string | null
          ticket_number: number
          total: number
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          delivery_phone?: string | null
          id?: string
          kds_ack_at?: string | null
          notes?: string | null
          order_type?: string
          payment_method: string
          printed_at?: string | null
          source?: string
          status?: string
          subtotal?: number
          table_id?: string | null
          ticket_number?: number
          total?: number
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          delivery_address?: string | null
          delivery_fee?: number
          delivery_phone?: string | null
          id?: string
          kds_ack_at?: string | null
          notes?: string | null
          order_type?: string
          payment_method?: string
          printed_at?: string | null
          source?: string
          status?: string
          subtotal?: number
          table_id?: string | null
          ticket_number?: number
          total?: number
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
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
          business_name: string
          city: string | null
          delivery_fee: number
          id: number
          logo_url: string | null
          menu_link: string | null
          nit: string | null
          phone: string | null
          schedules: Json
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_name?: string
          city?: string | null
          delivery_fee?: number
          id?: number
          logo_url?: string | null
          menu_link?: string | null
          nit?: string | null
          phone?: string | null
          schedules?: Json
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_name?: string
          city?: string | null
          delivery_fee?: number
          id?: number
          logo_url?: string | null
          menu_link?: string | null
          nit?: string | null
          phone?: string | null
          schedules?: Json
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "cajero"
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
      app_role: ["admin", "cajero"],
    },
  },
} as const
