/**
 * ProductsController — /v1/products/{id}. Edit / soft-deactivate a product. — arch §6.3
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProductsService } from './products.service';
import { ListAllProductsQuery, UpdateProductDto } from './dto/product.dto';
import { ProductPageResponse, ProductResponse } from './dto/client.response';

@ApiTags('Clients & Products')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission('clients', 'view')
  @ApiOperation({
    summary: 'List products (cross-client)',
    description:
      'Requires clients:view. Paginated (page/limit/sort/search) + filters client_id/product_type/status.',
  })
  @ApiOkResponse({ type: ProductPageResponse })
  findAll(@Query() query: ListAllProductsQuery) {
    return this.products.findAll(query);
  }

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
