// Hand-written to match supabase/migrations/*.sql. If the schema changes,
// update this file to match — there's no `supabase gen types` step wired up.
//
// Every Table/View carries `Relationships: []` even though we don't use
// embedded resource queries — @supabase/postgrest-js's GenericTable/
// GenericView constraint requires the field to exist, and silently falls
// back to `never` (breaking .insert()/.update() typing) if it's missing.

export type Unit = "ml" | "l" | "g" | "kg" | "vnt" | "tabletkė" | "dozė";
export type ProductCategory = "medicines" | "vaccines" | "biocides" | "materials" | "hygiene" | "other";
export type BatchStatus = "active" | "depleted" | "expired";
export type StockStatus = "expired" | "depleted" | "low" | "available";
export type MovementType = "pajamavimas" | "nurašymas";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          is_admin: boolean;
          logo_url: string | null;
          theme: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & { id: string; email: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          address: string | null;
          phone: string | null;
          email: string | null;
          is_company: boolean;
          company_code: string | null;
          vat_code: string | null;
          notes: string | null;
          country_code: string | null;
          external_source: string | null;
          external_id: string | null;
          synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["clients"]["Row"]> & { name: string };
        Update: Partial<Database["public"]["Tables"]["clients"]["Row"]>;
        Relationships: [];
      };
      suppliers: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          code: string | null;
          vat_code: string | null;
          phone: string | null;
          email: string | null;
          iban: string | null;
          address: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["suppliers"]["Row"]> & { name: string };
        Update: Partial<Database["public"]["Tables"]["suppliers"]["Row"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          category: ProductCategory;
          unit: Unit;
          package_size: number | null;
          active_substance: string | null;
          registration_code: string | null;
          withdrawal_days_meat: number | null;
          withdrawal_days_milk: number | null;
          withdrawal_iv_meat: number | null;
          withdrawal_iv_milk: number | null;
          withdrawal_im_meat: number | null;
          withdrawal_im_milk: number | null;
          withdrawal_sc_meat: number | null;
          withdrawal_sc_milk: number | null;
          withdrawal_iu_meat: number | null;
          withdrawal_iu_milk: number | null;
          withdrawal_imm_meat: number | null;
          withdrawal_imm_milk: number | null;
          withdrawal_pos_meat: number | null;
          withdrawal_pos_milk: number | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["products"]["Row"]> & {
          name: string;
          unit: Unit;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Row"]>;
        Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          user_id: string;
          invoice_number: string | null;
          invoice_date: string | null;
          supplier_id: string | null;
          supplier_name: string | null;
          supplier_code: string | null;
          supplier_vat: string | null;
          currency: string | null;
          total_net: number | null;
          total_vat: number | null;
          total_gross: number | null;
          pdf_filename: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["invoices"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["invoices"]["Row"]>;
        Relationships: [];
      };
      invoice_items: {
        Row: {
          id: string;
          user_id: string;
          invoice_id: string;
          batch_id: string | null;
          description: string | null;
          quantity: number | null;
          unit_price: number | null;
          total_price: number | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["invoice_items"]["Row"]> & { invoice_id: string };
        Update: Partial<Database["public"]["Tables"]["invoice_items"]["Row"]>;
        Relationships: [];
      };
      batches: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          supplier_id: string | null;
          invoice_id: string | null;
          lot: string | null;
          mfg_date: string | null;
          expiry_date: string | null;
          doc_title: string | null;
          doc_number: string | null;
          doc_date: string | null;
          purchase_price: number | null;
          currency: string | null;
          received_qty: number;
          package_count: number | null;
          qty_left: number | null;
          unit: Unit;
          status: BatchStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["batches"]["Row"]> & {
          product_id: string;
          received_qty: number;
          unit: Unit;
        };
        Update: Partial<Database["public"]["Tables"]["batches"]["Row"]>;
        Relationships: [];
      };
      animals: {
        Row: {
          id: string;
          user_id: string;
          tag_no: string;
          name: string | null;
          species: string;
          sex: string | null;
          breed: string | null;
          birth_date: string | null;
          client_id: string | null;
          active: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["animals"]["Row"]> & { tag_no: string };
        Update: Partial<Database["public"]["Tables"]["animals"]["Row"]>;
        Relationships: [];
      };
      visits: {
        Row: {
          id: string;
          user_id: string;
          animal_id: string | null;
          visit_date: string;
          reason: string | null;
          diagnosis: string | null;
          services: string | null;
          service_price: number | null;
          vet_name: string | null;
          notes: string | null;
          withdrawal_until_meat: string | null;
          withdrawal_until_milk: string | null;
          first_symptoms_date: string | null;
          tests: string | null;
          outcome: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["visits"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["visits"]["Row"]>;
        Relationships: [];
      };
      usage_items: {
        Row: {
          id: string;
          user_id: string;
          visit_id: string | null;
          biocide_usage_id: string | null;
          product_id: string;
          batch_id: string;
          qty: number;
          unit: Unit;
          administration_route: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["usage_items"]["Row"]> & {
          visit_id: string;
          product_id: string;
          batch_id: string;
          qty: number;
          unit: Unit;
        };
        Update: Partial<Database["public"]["Tables"]["usage_items"]["Row"]>;
        Relationships: [];
      };
      biocide_usage: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          batch_id: string;
          use_date: string;
          qty: number;
          unit: Unit;
          purpose: string | null;
          work_scope: string | null;
          used_by_name: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["biocide_usage"]["Row"]> & {
          product_id: string;
          batch_id: string;
          qty: number;
          unit: Unit;
        };
        Update: Partial<Database["public"]["Tables"]["biocide_usage"]["Row"]>;
        Relationships: [];
      };
    };
    Views: {
      stock_by_batch: {
        Row: {
          batch_id: string;
          user_id: string;
          product_id: string;
          product_name: string;
          product_category: ProductCategory;
          lot: string | null;
          expiry_date: string | null;
          mfg_date: string | null;
          received_qty: number;
          qty_left: number | null;
          unit: Unit;
          status: BatchStatus;
          purchase_price: number | null;
          currency: string | null;
          doc_number: string | null;
          doc_date: string | null;
          supplier_name: string | null;
          stock_status: StockStatus;
          created_at: string;
        };
        Relationships: [];
      };
      stock_by_product: {
        Row: {
          user_id: string;
          product_id: string;
          product_name: string;
          product_category: ProductCategory;
          unit: Unit;
          on_hand: number;
          low_stock_batches: number;
          expired_batches: number;
          nearest_expiry: string | null;
        };
        Relationships: [];
      };
      stock_movements: {
        Row: {
          movement_id: string;
          user_id: string;
          movement_type: MovementType;
          movement_at: string;
          product_id: string;
          product_name: string;
          qty: number;
          unit: Unit;
          lot: string | null;
          supplier_name: string | null;
          doc_number: string | null;
          doc_date: string | null;
          visit_id: string | null;
          animal_id: string | null;
          animal_tag: string | null;
        };
        Relationships: [];
      };
      visit_history_view: {
        Row: {
          visit_id: string;
          user_id: string;
          visit_date: string;
          reason: string | null;
          diagnosis: string | null;
          services: string | null;
          service_price: number | null;
          vet_name: string | null;
          notes: string | null;
          withdrawal_until_meat: string | null;
          withdrawal_until_milk: string | null;
          created_at: string;
          animal_id: string | null;
          animal_tag: string | null;
          animal_name: string | null;
          species: string | null;
          client_id: string | null;
          client_name: string | null;
          products_used: {
            product_name: string;
            quantity: number;
            unit: Unit;
            batch_lot: string | null;
            administration_route: string | null;
          }[];
          first_symptoms_date: string | null;
          tests: string | null;
          outcome: string | null;
        };
        Relationships: [];
      };
      vw_treated_animals_registry: {
        Row: {
          visit_id: string;
          user_id: string;
          registration_date: string;
          created_at: string;
          animal_id: string;
          animal_tag: string;
          animal_name: string | null;
          species: string;
          sex: string | null;
          birth_date: string | null;
          client_id: string | null;
          owner_name: string | null;
          owner_address: string | null;
          first_symptoms_date: string | null;
          animal_condition: string | null;
          tests: string | null;
          clinical_diagnosis: string | null;
          services: string | null;
          medicines: string | null;
          outcome: string | null;
          veterinarian: string | null;
          notes: string | null;
        };
        Relationships: [];
      };
      vw_vet_drug_journal: {
        Row: {
          batch_id: string;
          user_id: string;
          product_id: string;
          product_name: string;
          category: ProductCategory;
          registration_code: string | null;
          active_substance: string | null;
          unit: Unit;
          receipt_date: string;
          supplier_name: string | null;
          doc_title: string | null;
          doc_number: string | null;
          doc_date: string | null;
          batch_number: string | null;
          mfg_date: string | null;
          expiry_date: string | null;
          quantity_received: number;
          quantity_used: number;
          quantity_remaining: number;
          created_at: string;
        };
        Relationships: [];
      };
      vw_biocide_receiving_journal: {
        Row: {
          batch_id: string;
          user_id: string;
          product_id: string;
          biocide_name: string;
          registration_code: string | null;
          active_substance: string | null;
          unit: Unit;
          receipt_date: string;
          supplier_name: string | null;
          doc_title: string | null;
          doc_number: string | null;
          doc_date: string | null;
          quantity_received: number;
          mfg_date: string | null;
          expiry_date: string | null;
          batch_number: string | null;
          created_at: string;
        };
        Relationships: [];
      };
      vw_biocide_journal: {
        Row: {
          entry_id: string;
          user_id: string;
          product_id: string;
          biocide_name: string;
          registration_code: string | null;
          active_substance: string | null;
          biocide_usage_id: string | null;
          visit_id: string | null;
          use_date: string;
          purpose: string | null;
          work_scope: string | null;
          quantity_used: number;
          unit: Unit;
          batch_number: string | null;
          batch_expiry: string | null;
          applied_by: string | null;
          notes: string | null;
          quantity_remaining: number;
          created_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      fn_fifo_batch: {
        Args: { p_product_id: string };
        Returns: string | null;
      };
    };
  };
}
