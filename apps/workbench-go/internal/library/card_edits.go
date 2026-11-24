package library

import (
	"context"

	"knowflick.local/workbench-go/internal/cards"
)

type CardPage struct {
	Cards   []cards.EditableCard `json:"cards"`
	HasMore bool                 `json:"hasMore"`
}

func (l *Library) BrowseCards(ctx context.Context, query string, offset int) (CardPage, error) {
	items, err := cards.Browse(ctx, l.db, query, PageSize+1, offset)
	if err != nil {
		return CardPage{}, err
	}
	page := CardPage{Cards: items, HasMore: len(items) > PageSize}
	if page.HasMore {
		page.Cards = page.Cards[:PageSize]
	}
	return page, nil
}

func (l *Library) SaveCardContent(ctx context.Context, card cards.EditableCard, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	return cards.SaveContent(ctx, l.db, card, now)
}

func (l *Library) DeleteCardContent(ctx context.Context, id string, version, now int64) error {
	if !l.writable {
		return ErrReadOnly
	}
	return cards.DeleteContent(ctx, l.db, id, version, now)
}
