import { FlowOperationType } from '@activepieces/shared';

import {
  CardListItem,
  CardListItemSkeleton,
} from '@/components/custom/card-list';
import { VirtualizedScrollArea } from '@/components/ui/virtualized-scroll-area';
import {
  PieceIcon,
  piecesHooks,
  PieceSelectorTabType,
  usePieceSelectorTabs,
  PieceSelectorOperation,
  StepMetadataWithSuggestions,
  CategorizedStepMetadataWithSuggestions,
  PIECE_SELECTOR_ELEMENTS_HEIGHTS,
} from '@/features/pieces';

import { PieceActionsOrTriggersList } from './piece-actions-or-triggers-list';

const ExploreTabContent = ({
  operation,
}: {
  operation: PieceSelectorOperation;
}) => {
  const { selectedTab, selectedPieceInExplore, setSelectedPieceInExplore } =
    usePieceSelectorTabs();
  const { data: categories, isLoading: isLoadingPieces } =
    piecesHooks.usePiecesSearch({
      shouldCaptureEvent: false,
      searchQuery: '',
      type:
        operation.type === FlowOperationType.UPDATE_TRIGGER
          ? 'trigger'
          : 'action',
    });
  if (selectedTab !== PieceSelectorTabType.EXPLORE) {
    return null;
  }
  if (isLoadingPieces) {
    return (
      <div className="flex flex-col gap-2 w-full">
        <CardListItemSkeleton numberOfCards={2} withCircle={false} />
      </div>
    );
  }

  if (selectedPieceInExplore) {
    return (
      <div className="w-full">
        <PieceActionsOrTriggersList
          stepMetadataWithSuggestions={selectedPieceInExplore}
          hidePieceIconAndDescription={false}
          operation={operation}
        />
      </div>
    );
  }

  const virtualizedItems = flattenCategoriesToVirtualizedItems(categories);

  return (
    <div className="h-full w-full p-2">
      <VirtualizedScrollArea
        items={virtualizedItems}
        estimateSize={(index) => virtualizedItems[index].height}
        getItemKey={(index) => virtualizedItems[index].id}
        renderItem={(item) => {
          if (item.kind === 'category') {
            return (
              <div className="text-sm text-muted-foreground mb-1.5">
                {item.title}
              </div>
            );
          }
          const { pieceMetadata } = item;
          return (
            <CardListItem
              className="rounded-sm py-3"
              onClick={() => setSelectedPieceInExplore(pieceMetadata)}
            >
              <div className="flex gap-2 items-center h-full">
                <PieceIcon
                  logoUrl={pieceMetadata.logoUrl}
                  displayName={pieceMetadata.displayName}
                  showTooltip={false}
                  size={'sm'}
                />
                <div className="grow h-full flex items-center justify-left text-sm">
                  {pieceMetadata.displayName}
                </div>
              </div>
            </CardListItem>
          );
        }}
      />
    </div>
  );
};

export { ExploreTabContent };

function flattenCategoriesToVirtualizedItems(
  categories: CategorizedStepMetadataWithSuggestions[],
): ExploreVirtualizedItem[] {
  return categories.reduce<ExploreVirtualizedItem[]>((result, category) => {
    result.push({
      kind: 'category',
      id: `category-${category.title}`,
      title: category.title,
      height: PIECE_SELECTOR_ELEMENTS_HEIGHTS.CATEGORY_ITEM_HEIGHT,
    });
    category.metadata.forEach((pieceMetadata, index) => {
      result.push({
        kind: 'piece',
        id: `${category.title}-${getPieceKey(pieceMetadata)}-${index}`,
        pieceMetadata,
        height: PIECE_SELECTOR_ELEMENTS_HEIGHTS.PIECE_ITEM_HEIGHT,
      });
    });
    return result;
  }, []);
}

function getPieceKey(pieceMetadata: StepMetadataWithSuggestions): string {
  return 'pieceName' in pieceMetadata
    ? pieceMetadata.pieceName
    : pieceMetadata.type;
}

type ExploreVirtualizedItem =
  | {
      kind: 'category';
      id: string;
      title: string;
      height: number;
    }
  | {
      kind: 'piece';
      id: string;
      pieceMetadata: StepMetadataWithSuggestions;
      height: number;
    };
