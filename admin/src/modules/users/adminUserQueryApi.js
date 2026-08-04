import { postAdminRead } from "@/api/client";

export function queryFormalUserByPhone(phone) {
  return postAdminRead("/api/v1/admin/formal-users/query", { phone });
}
