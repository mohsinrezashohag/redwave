/**
 * SuccessResponse — the minimal `{ success: true }` body returned by side-effect endpoints that have no
 * entity to return (logout, change-password). Shared so the contract documents one shape. — Batch A #2
 */
import { ApiProperty } from '@nestjs/swagger';

export class SuccessResponse {
  @ApiProperty({ example: true })
  success!: boolean;
}
