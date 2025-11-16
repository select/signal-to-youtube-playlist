# Agent Development Guidelines

## Functional Programming Requirements

This project follows strict functional programming principles. All code MUST adhere to these rules:

### Core Rules

1. **No For Loops**: Never use `for`, `for...of`, `for...in`, or `while` loops
   - Use array methods like `map()`, `filter()`, `reduce()`, `forEach()` instead
   - Use recursion for complex iterations when necessary

2. **Prefer Immutability**: 
   - Use `const` by default, `let` only when reassignment is absolutely necessary
   - Avoid mutating arrays and objects directly
   - Use spread operator (`...`) and array/object methods that return new instances

3. **Pure Functions**: 
   - Functions should not have side effects
   - Same input should always produce same output
   - Avoid modifying parameters passed to functions

4. **Functional Array Operations**:
   ```typescript
   // ✅ Good - functional style
   const processedData = data
     .filter(item => item.isValid)
     .map(item => ({ ...item, processed: true }))
     .reduce((acc, item) => ({ ...acc, [item.id]: item }), {});

   // ❌ Bad - imperative style
   const result = {};
   for (const item of data) {
     if (item.isValid) {
       result[item.id] = { ...item, processed: true };
     }
   }
   ```

5. **Function Composition**: 
   - Break complex operations into small, composable functions
   - Use pipe-like operations with method chaining
   - Prefer function composition over nested conditionals

### TypeScript Requirements

- Use strict TypeScript types for all function parameters and return values
- Define interfaces for all data structures
- Use union types and generics appropriately
- Leverage TypeScript's functional programming features

### Error Handling

- Use functional error handling patterns (Result types, Option types when applicable)
- Avoid try-catch blocks in favor of functional error handling where possible
- Return errors as values rather than throwing exceptions when feasible

### Examples

**Data Processing Pipeline**:
```typescript
const processMetadata = (data: YouTubeMetadata[]) =>
  data
    .filter(entry => entry.userId !== null)
    .map(entry => ({ ...entry, timestamp: new Date(entry.datetime) }))
    .sort((a, b) => a.datetime - b.datetime);
```

**Deduplication**:
```typescript
const deduplicateEntries = (entries: YouTubeMetadata[]): YouTubeMetadata[] =>
  Array.from(
    entries
      .reduce((map, entry) => {
        const key = `${entry.videoId}:${entry.userId}`;
        const existing = map.get(key);
        return map.set(
          key,
          !existing || entry.datetime < existing.datetime ? entry : existing
        );
      }, new Map<string, YouTubeMetadata>())
      .values()
  );
```

### Testing

- Write pure functions that are easy to test
- Use property-based testing where appropriate
- Test edge cases and error conditions functionally

These guidelines ensure code maintainability, predictability, and easier reasoning about program behavior.