#include <stdio.h>
#include <string.h>

enum { SIDE = 20, CELLS = SIDE * SIDE, NONE = -1 };
enum { UP, LEFT, DOWN, RIGHT, DIRECTIONS };
static const char keys[] = "WASD";
static const int dr[] = {-1, 0, 1, 0};
static const int dc[] = {0, -1, 0, 1};

typedef struct {
    int body[CELLS];              /* In order from head to tail. */
    unsigned char occupied[CELLS];
    int length, direction, food, until_growth;
    long long score;
} State;

static int neighbor[CELLS][DIRECTIONS];
static char terrain[CELLS];
static unsigned int visits[CELLS][DIRECTIONS];
static int interval;

static void init_neighbors(void)
{
    for (int pos = 0; pos < CELLS; ++pos) {
        for (int d = 0; d < DIRECTIONS; ++d) {
            int row = pos / SIDE + dr[d], col = pos % SIDE + dc[d];
            neighbor[pos][d] = row >= 0 && row < SIDE && col >= 0 && col < SIDE
                              ? row * SIDE + col : NONE;
        }
    }
}

static int read_start(State *s)
{
    char row[SIDE + 1];
    int head = NONE;
    s->food = NONE;
    for (int r = 0; r < SIDE; ++r) {
        if (scanf("%20s", row) != 1 || strlen(row) != SIDE)
            return 0;
        for (int c = 0; c < SIDE; ++c) {
            int pos = r * SIDE + c;
            terrain[pos] = row[c] == '#' || row[c] == 'O' ? row[c] : '.';
            if (row[c] == 'H')
                head = pos;
            if (row[c] == 'B')
                s->occupied[pos] = 1;
            if (row[c] == 'F')
                s->food = pos;
        }
    }
    if (scanf("%d", &interval) != 1 || interval <= 0 || head == NONE)
        return 0;

    s->body[0] = head;
    s->length = 3;
    s->direction = UP;
    s->until_growth = interval;
    s->occupied[head] = 1;
    for (int i = 1; i < s->length; ++i) {
        int next = NONE;
        for (int d = 0; d < DIRECTIONS; ++d) {
            int p = neighbor[s->body[i - 1]][d];
            if (p != NONE && s->occupied[p] && p != head)
                next = p;
        }
        if (next == NONE)
            return 0;
        s->body[i] = next;
        s->occupied[next] = 0;
    }
    for (int i = 1; i < s->length; ++i)
        s->occupied[s->body[i]] = 1;
    return 1;
}

static int can_move(const State *s, int d, int allow_old_tail)
{
    int p = neighbor[s->body[0]][d];
    if (d == (s->direction + 2) % DIRECTIONS ||
        p == NONE || terrain[p] != '.')
        return 0;
    if (!s->occupied[p])
        return 1;
    return allow_old_tail && p == s->body[s->length - 1] &&
           s->until_growth != 1 && p != s->food;
}

static void move_snake(State *s, int d)
{
    int p = neighbor[s->body[0]][d];
    int eats = p == s->food;
    int grows = eats || s->until_growth == 1;
    if (!grows)
        s->occupied[s->body[s->length - 1]] = 0;
    memmove(s->body + 1, s->body,
            (size_t)(s->length - !grows) * sizeof s->body[0]);
    s->length += grows;
    s->body[0] = p;
    s->occupied[p] = 1;
    s->direction = d;
    if (--s->until_growth == 0)
        s->until_growth = interval;
    if (eats) {
        s->score += 10;
        s->food = NONE;
    }
}

/* BFS through free cells. Record how to reach the food and whether any
   reachable free cell touches the tail. */
static int explore(const State *s, int incoming[CELLS], int *near_tail)
{
    int queue[CELLS], first = 0, count = 1;
    int head = s->body[0], tail = s->body[s->length - 1];
    for (int p = 0; p < CELLS; ++p)
        incoming[p] = NONE;
    queue[0] = head;
    incoming[head] = DIRECTIONS;
    *near_tail = 0;
    while (first < count) {
        int p = queue[first++];
        for (int d = 0; d < DIRECTIONS; ++d) {
            if (p == head && d == (s->direction + 2) % DIRECTIONS)
                continue;
            int q = neighbor[p][d];
            if (q == tail)
                *near_tail = 1;
            if (q == NONE || terrain[q] != '.' || s->occupied[q] ||
                incoming[q] != NONE)
                continue;
            incoming[q] = d;
            queue[count++] = q;
        }
    }
    return count;
}

static int manhattan(int a, int b)
{
    int row = a / SIDE - b / SIDE, col = a % SIDE - b % SIDE;
    return (row < 0 ? -row : row) + (col < 0 ? -col : col);
}

/* Returns an estimated safe route length, counting the initial move.
   The route is simulated to include every scheduled growth. */
static int route_to_food(State next, long long current_score,
                         const int incoming[CELLS])
{
    int path[CELLS], length = 0, p = next.food;
    if (next.score == current_score) {
        if (p == NONE || incoming[p] == NONE)
            return NONE;
        while (p != next.body[0]) {
            int d = incoming[p];
            path[length++] = d;
            p = neighbor[p][(d + 2) % DIRECTIONS];
        }
        for (int i = length - 1; i >= 0; --i) {
            if (!can_move(&next, path[i], 0))
                return NONE;
            move_snake(&next, path[i]);
        }
    }

    int after_eating[CELLS], near_tail;
    int space = explore(&next, after_eating, &near_tail);
    if (space <= 1 || (!near_tail && space <= next.length))
        return NONE;
    return 1 + length;
}

static int choose_direction(const State *s)
{
    int best = NONE, route = NONE, shortest = CELLS + 1;
    long long best_value = -1000000;
    for (int d = 0; d < DIRECTIONS; ++d) {
        if (!can_move(s, d, 0))
            continue;
        State next = *s;
        move_snake(&next, d);
        int incoming[CELLS], near_tail;
        int space = explore(&next, incoming, &near_tail);
        int distance = route_to_food(next, s->score, incoming);
        if (distance != NONE && distance < shortest) {
            shortest = distance;
            route = d;
        }

        int p = next.body[0];
        int closeness = next.food == NONE ? 0 : manhattan(p, next.food);
        long long value = 3LL * space + 15 * near_tail - 2 * closeness;
        value -= 30LL * visits[p][d];
        if (next.score > s->score && space > 1)
            value += 45;
        if (space == 1)
            value -= 1000;
        if (best == NONE || value > best_value) {
            best_value = value;
            best = d;
        }
    }
    if (route != NONE)
        return route;
    if (best != NONE)
        return best;
    /* Try the vacating tail only as a last resort. The judge decides
       whether the move is legal before our state is updated. */
    for (int d = 0; d < DIRECTIONS; ++d) {
        if (can_move(s, d, 1))
            return d;
    }
    return s->direction;
}

static void print_final(const State *s)
{
    char board[CELLS];
    memcpy(board, terrain, sizeof board);
    if (s->food != NONE)
        board[s->food] = 'F';
    for (int i = s->length - 1; i > 0; --i)
        board[s->body[i]] = 'B';
    board[s->body[0]] = 'H';
    for (int r = 0; r < SIDE; ++r)
        printf("%.*s\n", SIDE, board + r * SIDE);
    printf("%lld\n", s->score);
    fflush(stdout);
}

int main(void)
{
    State state = {0};
    init_neighbors();
    if (!read_start(&state))
        return 0;
    for (;;) {
        int direction = choose_direction(&state);
        printf("%c\n%lld\n", keys[direction], state.score);
        fflush(stdout);

        int row, col;
        if (scanf("%d%d", &row, &col) != 2)
            return 0;
        if (row == 100 && col == 100) {
            print_final(&state);
            return 0;
        }
        long long old_score = state.score;
        move_snake(&state, direction);
        if (state.score != old_score)
            memset(visits, 0, sizeof visits);
        ++visits[state.body[0]][direction];
        if (row > 0 && row < SIDE - 1 && col > 0 && col < SIDE - 1)
            state.food = row * SIDE + col;
    }
}
