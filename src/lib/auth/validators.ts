import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .email("Enter a valid email address.")
  .max(320);

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128);

export const signUpBodySchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const signInBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const deleteAccountBodySchema = z.object({
  /** When true, wipe app data but keep the login account. */
  eraseDataOnly: z.boolean().optional().default(false),
  password: z.string().min(1, "Enter your password to confirm."),
});
