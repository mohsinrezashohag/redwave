/**
 * Product-type catalogue hooks. GET is an authenticated reference read (product / flat-rate / incentive
 * forms use it); create/edit require commission:edit (server is the real gate). Mutations invalidate the
 * catalogue key so dependent dropdowns refresh. (Sales playbook: TanStack Query + unwrap + invalidate.)
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { unwrapList } from '../../../lib/query/unwrapList';
import type { CreateProductTypeBody, ProductType, UpdateProductTypeBody } from '../productTypes.types';

export const productTypeKeys = {
  all: ['product-types'] as const,
  list: (status: 'active' | 'all') => ['product-types', 'list', status] as const,
};

/** The catalogue (all or active-only). Cached a while — it changes rarely. */
export function useProductTypes(status: 'active' | 'all' = 'all', enabled = true) {
  return useQuery({
    queryKey: productTypeKeys.list(status),
    queryFn: () => unwrapList<ProductType>(api.GET('/v1/product-types', { params: { query: { status } } })),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCreateProductType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProductTypeBody) => unwrap<ProductType>(api.POST('/v1/product-types', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: productTypeKeys.all }),
  });
}

export function useUpdateProductType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: UpdateProductTypeBody }) =>
      unwrap<ProductType>(api.PATCH('/v1/product-types/{key}', { params: { path: { key } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: productTypeKeys.all }),
  });
}
