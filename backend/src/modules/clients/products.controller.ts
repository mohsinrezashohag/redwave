/**
 * ProductsController — /v1/products/{id}. Edit / soft-deactivate a product. — arch §6.3
 */
import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProductsService } from './products.service';
import { UpdateProductDto } from './dto/product.dto';
import { ProductResponse } from './dto/client.response';

@ApiTags('Clients & Products')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Patch(':id')
  @RequirePermission('clients', 'edit')
  @ApiOperation({
    summary: 'Edit / deactivate a product',
    description:
      'Requires clients:edit. product_type is immutable; is_active=false soft-deactivates.',
  })
  @ApiOkResponse({ type: ProductResponse })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.products.update(id, dto, actorId);
  }
}
