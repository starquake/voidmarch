package players

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/starquake/voidmarch/internal/handlers"
)

// errRegisterFailed is what a player sees when the database fails them.
var errRegisterFailed = errors.New("the server couldn't save your name, try again")

// HandleRegister registers a player by name and returns their id and token,
// which the browser keeps for the WebSocket's Hello.
func HandleRegister(logger *slog.Logger, store *Store) http.Handler {
	type request struct {
		Name string `json:"name"`
	}
	type response struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Token string `json:"token"`
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		req, err := handlers.DecodeJSON[request](w, r)
		if errors.Is(err, handlers.ErrNotJSON) {
			writeError(w, r, logger, http.StatusUnsupportedMediaType, err)

			return
		}
		if err != nil {
			writeError(w, r, logger, http.StatusBadRequest, err)

			return
		}

		player, token, err := store.Register(ctx, req.Name)
		if errors.Is(err, ErrInvalidName) {
			writeError(w, r, logger, http.StatusBadRequest, ErrInvalidName)

			return
		}
		if err != nil {
			logger.ErrorContext(ctx, "error registering player", slog.Any("err", err))
			writeError(w, r, logger, http.StatusInternalServerError, errRegisterFailed)

			return
		}

		logger.InfoContext(ctx, "player registered",
			slog.String("playerId", player.ID),
			slog.String("name", player.Name),
		)
		res := response{ID: player.ID, Name: player.Name, Token: token}
		if err = handlers.EncodeJSON(w, http.StatusCreated, res); err != nil {
			logger.ErrorContext(ctx, "error encoding register response", slog.Any("err", err))
		}
	})
}

// writeError answers with a JSON error; its message is safe to show players.
func writeError(
	w http.ResponseWriter,
	r *http.Request,
	logger *slog.Logger,
	status int,
	err error,
) {
	type errorResponse struct {
		Error string `json:"error"`
	}

	if encErr := handlers.EncodeJSON(w, status, errorResponse{Error: err.Error()}); encErr != nil {
		logger.ErrorContext(r.Context(), "error encoding error response", slog.Any("err", encErr))
	}
}
