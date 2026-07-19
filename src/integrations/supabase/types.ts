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
      attempt_answers: {
        Row: {
          attempt_id: string
          chosen_answer: string | null
          created_at: string
          id: string
          is_correct: boolean | null
          last_saved_at: string | null
          marked_for_review: boolean
          notes: string | null
          question_id: string
          tags: string[] | null
          time_spent_sec: number
          updated_at: string
          visited: boolean
        }
        Insert: {
          attempt_id: string
          chosen_answer?: string | null
          created_at?: string
          id?: string
          is_correct?: boolean | null
          last_saved_at?: string | null
          marked_for_review?: boolean
          notes?: string | null
          question_id: string
          tags?: string[] | null
          time_spent_sec?: number
          updated_at?: string
          visited?: boolean
        }
        Update: {
          attempt_id?: string
          chosen_answer?: string | null
          created_at?: string
          id?: string
          is_correct?: boolean | null
          last_saved_at?: string | null
          marked_for_review?: boolean
          notes?: string | null
          question_id?: string
          tags?: string[] | null
          time_spent_sec?: number
          updated_at?: string
          visited?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "attempt_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "test_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempt_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      chapters: {
        Row: {
          created_at: string
          id: string
          name: string
          order_index: number
          slug: string
          subject_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          order_index?: number
          slug: string
          subject_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          order_index?: number
          slug?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chapters_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          id: string
          job_id: string
          payload: Json | null
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          id?: string
          job_id: string
          payload?: Json | null
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          id?: string
          job_id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_audit_log_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_batches: {
        Row: {
          attempts: number
          batch_storage_path: string | null
          created_at: string
          id: string
          job_id: string
          last_error: string | null
          page_from: number
          page_to: number
          parsed: Json | null
          raw_response: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          batch_storage_path?: string | null
          created_at?: string
          id?: string
          job_id: string
          last_error?: string | null
          page_from: number
          page_to: number
          parsed?: Json | null
          raw_response?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          batch_storage_path?: string | null
          created_at?: string
          id?: string
          job_id?: string
          last_error?: string | null
          page_from?: number
          page_to?: number
          parsed?: Json | null
          raw_response?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_batches_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          exam: Database["public"]["Enums"]["exam_type"] | null
          expected_question_count: number | null
          extraction_score: number | null
          id: string
          last_error: string | null
          original_filename: string
          page_count: number | null
          pdf_storage_path: string
          status: Database["public"]["Enums"]["extraction_status"]
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          exam?: Database["public"]["Enums"]["exam_type"] | null
          expected_question_count?: number | null
          extraction_score?: number | null
          id?: string
          last_error?: string | null
          original_filename: string
          page_count?: number | null
          pdf_storage_path: string
          status?: Database["public"]["Enums"]["extraction_status"]
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          exam?: Database["public"]["Enums"]["exam_type"] | null
          expected_question_count?: number | null
          extraction_score?: number | null
          id?: string
          last_error?: string | null
          original_filename?: string
          page_count?: number | null
          pdf_storage_path?: string
          status?: Database["public"]["Enums"]["extraction_status"]
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      extraction_pages: {
        Row: {
          created_at: string
          id: string
          image_storage_path: string | null
          job_id: string
          last_error: string | null
          page_number: number
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_storage_path?: string | null
          job_id: string
          last_error?: string | null
          page_number: number
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_storage_path?: string | null
          job_id?: string
          last_error?: string | null
          page_number?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_pages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_questions: {
        Row: {
          answer: string | null
          batch_id: string | null
          created_at: string
          has_image: boolean
          id: string
          image_storage_path: string | null
          job_id: string
          options: Json
          question_number: number
          question_text: string
          source_page: number | null
          status: Database["public"]["Enums"]["extraction_question_status"]
          subject: string | null
          type: Database["public"]["Enums"]["question_type"]
          updated_at: string
          validation_flags: Json
        }
        Insert: {
          answer?: string | null
          batch_id?: string | null
          created_at?: string
          has_image?: boolean
          id?: string
          image_storage_path?: string | null
          job_id: string
          options?: Json
          question_number: number
          question_text?: string
          source_page?: number | null
          status?: Database["public"]["Enums"]["extraction_question_status"]
          subject?: string | null
          type?: Database["public"]["Enums"]["question_type"]
          updated_at?: string
          validation_flags?: Json
        }
        Update: {
          answer?: string | null
          batch_id?: string | null
          created_at?: string
          has_image?: boolean
          id?: string
          image_storage_path?: string | null
          job_id?: string
          options?: Json
          question_number?: number
          question_text?: string
          source_page?: number | null
          status?: Database["public"]["Enums"]["extraction_question_status"]
          subject?: string | null
          type?: Database["public"]["Enums"]["question_type"]
          updated_at?: string
          validation_flags?: Json
        }
        Relationships: [
          {
            foreignKeyName: "extraction_questions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "extraction_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_questions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_validation_reports: {
        Row: {
          broken_equations: number[]
          broken_options: number[]
          duplicates: number[]
          empty_questions: number[]
          generated_at: string
          id: string
          invalid_json: boolean
          job_id: string
          missing_numbers: number[]
          raw: Json | null
          score: number | null
        }
        Insert: {
          broken_equations?: number[]
          broken_options?: number[]
          duplicates?: number[]
          empty_questions?: number[]
          generated_at?: string
          id?: string
          invalid_json?: boolean
          job_id: string
          missing_numbers?: number[]
          raw?: Json | null
          score?: number | null
        }
        Update: {
          broken_equations?: number[]
          broken_options?: number[]
          duplicates?: number[]
          empty_questions?: number[]
          generated_at?: string
          id?: string
          invalid_json?: boolean
          job_id?: string
          missing_numbers?: number[]
          raw?: Json | null
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_validation_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          photo_url: string | null
          target_exam: Database["public"]["Enums"]["exam_type"] | null
          target_score: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          photo_url?: string | null
          target_exam?: Database["public"]["Enums"]["exam_type"] | null
          target_score?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          photo_url?: string | null
          target_exam?: Database["public"]["Enums"]["exam_type"] | null
          target_score?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      question_images: {
        Row: {
          id: string
          order_index: number
          question_id: string
          role: string
          url: string
        }
        Insert: {
          id?: string
          order_index?: number
          question_id: string
          role?: string
          url: string
        }
        Update: {
          id?: string
          order_index?: number
          question_id?: string
          role?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_images_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          chapter_id: string | null
          correct_answer: string
          created_at: string
          created_by: string | null
          difficulty: Database["public"]["Enums"]["question_difficulty"]
          id: string
          is_published: boolean
          options: Json
          pyq_year: number | null
          question_image_url: string | null
          question_text: string
          solution_text: string | null
          solution_video_url: string | null
          source: string | null
          subject_id: string | null
          topic_id: string | null
          type: Database["public"]["Enums"]["question_type"]
          updated_at: string
        }
        Insert: {
          chapter_id?: string | null
          correct_answer: string
          created_at?: string
          created_by?: string | null
          difficulty?: Database["public"]["Enums"]["question_difficulty"]
          id?: string
          is_published?: boolean
          options?: Json
          pyq_year?: number | null
          question_image_url?: string | null
          question_text: string
          solution_text?: string | null
          solution_video_url?: string | null
          source?: string | null
          subject_id?: string | null
          topic_id?: string | null
          type?: Database["public"]["Enums"]["question_type"]
          updated_at?: string
        }
        Update: {
          chapter_id?: string | null
          correct_answer?: string
          created_at?: string
          created_by?: string | null
          difficulty?: Database["public"]["Enums"]["question_difficulty"]
          id?: string
          is_published?: boolean
          options?: Json
          pyq_year?: number | null
          question_image_url?: string | null
          question_text?: string
          solution_text?: string | null
          solution_video_url?: string | null
          source?: string | null
          subject_id?: string | null
          topic_id?: string | null
          type?: Database["public"]["Enums"]["question_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          created_at: string
          exam_scope: Database["public"]["Enums"]["exam_type"][]
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          exam_scope?: Database["public"]["Enums"]["exam_type"][]
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          exam_scope?: Database["public"]["Enums"]["exam_type"][]
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      test_attempts: {
        Row: {
          correct_count: number
          created_at: string
          focus_losses: number
          fullscreen_exits: number
          id: string
          incorrect_count: number
          last_activity_at: string | null
          proctoring_events: Json
          score: number | null
          started_at: string
          status: Database["public"]["Enums"]["attempt_status"]
          submitted_at: string | null
          tab_switches: number
          test_id: string
          time_spent_sec: number
          total_marks: number | null
          unattempted_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          correct_count?: number
          created_at?: string
          focus_losses?: number
          fullscreen_exits?: number
          id?: string
          incorrect_count?: number
          last_activity_at?: string | null
          proctoring_events?: Json
          score?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["attempt_status"]
          submitted_at?: string | null
          tab_switches?: number
          test_id: string
          time_spent_sec?: number
          total_marks?: number | null
          unattempted_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          correct_count?: number
          created_at?: string
          focus_losses?: number
          fullscreen_exits?: number
          id?: string
          incorrect_count?: number
          last_activity_at?: string | null
          proctoring_events?: Json
          score?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["attempt_status"]
          submitted_at?: string | null
          tab_switches?: number
          test_id?: string
          time_spent_sec?: number
          total_marks?: number | null
          unattempted_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_attempts_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      test_builder_audit: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          diff: Json | null
          entity: string
          entity_id: string | null
          id: string
          summary: string | null
          test_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          diff?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
          summary?: string | null
          test_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          diff?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
          summary?: string | null
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_builder_audit_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      test_questions: {
        Row: {
          id: string
          marks_override: Json | null
          order_index: number
          question_id: string
          section: string | null
          test_id: string
        }
        Insert: {
          id?: string
          marks_override?: Json | null
          order_index?: number
          question_id: string
          section?: string | null
          test_id: string
        }
        Update: {
          id?: string
          marks_override?: Json | null
          order_index?: number
          question_id?: string
          section?: string | null
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "test_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "test_questions_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "tests"
            referencedColumns: ["id"]
          },
        ]
      }
      tests: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          duration_min: number
          exam: Database["public"]["Enums"]["exam_type"]
          extraction_job_id: string | null
          id: string
          kind: Database["public"]["Enums"]["test_kind"]
          marking_scheme: Json
          scheduled_at: string | null
          status: Database["public"]["Enums"]["test_status"]
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_min?: number
          exam: Database["public"]["Enums"]["exam_type"]
          extraction_job_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["test_kind"]
          marking_scheme?: Json
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["test_status"]
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_min?: number
          exam?: Database["public"]["Enums"]["exam_type"]
          extraction_job_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["test_kind"]
          marking_scheme?: Json
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["test_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tests_extraction_job_fk"
            columns: ["extraction_job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          chapter_id: string
          id: string
          name: string
          order_index: number
          slug: string
        }
        Insert: {
          chapter_id: string
          id?: string
          name: string
          order_index?: number
          slug: string
        }
        Update: {
          chapter_id?: string
          id?: string
          name?: string
          order_index?: number
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "chapters"
            referencedColumns: ["id"]
          },
        ]
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
    }
    Enums: {
      app_role: "admin" | "student"
      attempt_status: "in_progress" | "submitted" | "abandoned"
      exam_type: "jee_main" | "jee_advanced" | "neet"
      extraction_question_status: "draft" | "edited" | "approved" | "rejected"
      extraction_status:
        | "uploaded"
        | "splitting"
        | "extracting"
        | "validating"
        | "needs_review"
        | "approved"
        | "published"
        | "failed"
      question_difficulty: "easy" | "medium" | "hard"
      question_type:
        | "single_correct"
        | "multiple_correct"
        | "integer"
        | "matrix_match"
        | "assertion_reason"
        | "paragraph"
      test_kind: "full" | "subject" | "chapter" | "pyq" | "custom"
      test_status: "draft" | "published" | "archived"
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
      app_role: ["admin", "student"],
      attempt_status: ["in_progress", "submitted", "abandoned"],
      exam_type: ["jee_main", "jee_advanced", "neet"],
      extraction_question_status: ["draft", "edited", "approved", "rejected"],
      extraction_status: [
        "uploaded",
        "splitting",
        "extracting",
        "validating",
        "needs_review",
        "approved",
        "published",
        "failed",
      ],
      question_difficulty: ["easy", "medium", "hard"],
      question_type: [
        "single_correct",
        "multiple_correct",
        "integer",
        "matrix_match",
        "assertion_reason",
        "paragraph",
      ],
      test_kind: ["full", "subject", "chapter", "pyq", "custom"],
      test_status: ["draft", "published", "archived"],
    },
  },
} as const
