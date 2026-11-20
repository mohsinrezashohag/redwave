/**
 * ChatbotController — the read-only assistant. — SRS RPT-011
 *   POST  /v1/chatbot/query   authenticated; the scoped tool layer keeps every answer within the caller's scope
 *   GET   /v1/chatbot/status  authenticated; which mode the assistant is in (ai | basic), for the UI banner
 *   GET   /v1/chatbot/config  settings:view; the AI model toggle + model id (never the API key)
 *   PATCH /v1/chatbot/config  settings:edit + Super Admin; turn the AI model on/off, set the model id
 */
import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { ChatbotService } from './chatbot.service';
import { ChatbotQueryDto } from './dto/chatbot-query.dto';
import { ChatbotConfigResponse, ChatbotStatusResponse, UpdateChatbotConfigDto } from './dto/chatbot.dto';
import { ChatResponse } from './dto/reporting.response';

@ApiTags('Reporting & Dashboards')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly chatbot: ChatbotService) {}

  @Post('query')
  @ApiOperation({
    summary: 'Ask the read-only assistant',
    description: 'Authenticated. Answers from Redwave data within the caller’s scope only (AI model when enabled, else the keyword assistant).',
  })
  @ApiCreatedResponse({ type: ChatResponse })
  query(@Body() dto: ChatbotQueryDto, @CurrentUser() user: AuthUser) {
    return this.chatbot.query(dto, user);
  }

  @Get('status')
  @ApiOperation({ summary: 'Assistant mode', description: 'Authenticated. ai when the language model is on, else basic.' })
  @ApiOkResponse({ type: ChatbotStatusResponse })
  status() {
    return this.chatbot.status();
  }

  @Get('config')
  @RequirePermission('settings', 'view')
  @ApiOperation({ summary: 'Assistant settings', description: 'settings:view. The API key itself is never returned.' })
  @ApiOkResponse({ type: ChatbotConfigResponse })
  getConfig() {
    return this.chatbot.getConfig();
  }

  @Patch('config')
  @RequirePermission('settings', 'edit')
  @ApiOperation({ summary: 'Update assistant settings', description: 'settings:edit, Super Admin only. Audited.' })
  @ApiOkResponse({ type: ChatbotConfigResponse })
  updateConfig(@Body() dto: UpdateChatbotConfigDto, @CurrentUser() user: AuthUser) {
    return this.chatbot.updateConfig(dto, user);
  }
}
