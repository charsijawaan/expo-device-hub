#import <UIKit/UIKit.h>
#include <string.h>

static NSData *snapshot_items(UIPasteboard *board) {
  NSMutableArray *items = [NSMutableArray array];
  for (NSUInteger index = 0; index < board.numberOfItems; index++) {
    NSIndexSet *itemSet = [NSIndexSet indexSetWithIndex:index];
    NSArray<NSString *> *types = [board pasteboardTypesForItemSet:itemSet].firstObject;
    NSMutableDictionary *item = [NSMutableDictionary dictionary];
    for (NSString *type in types) {
      NSData *value = [board dataForPasteboardType:type inItemSet:itemSet].firstObject;
      if (!value) return nil;
      // Some representations are dispatch_data objects. Copy the bytes into ordinary NSData
      // so the binary property list preserves every representation without changing its type.
      item[type] = [NSData dataWithBytes:value.bytes length:value.length];
    }
    [items addObject:item];
  }
  return [NSPropertyListSerialization dataWithPropertyList:items
                                                 format:NSPropertyListBinaryFormat_v1_0
                                                options:0
                                                  error:NULL];
}

static int restore_items(UIPasteboard *board) {
  NSData *input = [NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile];
  NSData *archive = [[NSData alloc] initWithBase64EncodedData:input options:NSDataBase64DecodingIgnoreUnknownCharacters];
  if (!archive) return 1;
  id items = [NSPropertyListSerialization propertyListWithData:archive
                                                       options:NSPropertyListImmutable
                                                        format:NULL
                                                         error:NULL];
  if (![items isKindOfClass:NSArray.class]) return 1;
  for (id item in items) {
    if (![item isKindOfClass:NSDictionary.class]) return 1;
    for (id type in item) {
      if (![type isKindOfClass:NSString.class] || ![item[type] isKindOfClass:NSData.class]) return 1;
    }
  }
  board.items = items;
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.25]];
  return 0;
}

// Unlike simctl pbcopy, this in-simulator writer works without a GUI login.
int main(int argc, char *argv[]) {
  @autoreleasepool {
    UIPasteboard *board = UIPasteboard.generalPasteboard;
    if (argc == 2 && strcmp(argv[1], "--change-count") == 0) {
      printf("%ld\n", (long)board.changeCount);
      return 0;
    }
    if (argc == 2 && strcmp(argv[1], "--snapshot") == 0) {
      NSData *archive = snapshot_items(board);
      if (!archive) { fputs("could not snapshot pasteboard items\n", stderr); return 1; }
      NSString *base64 = [archive base64EncodedStringWithOptions:0];
      printf("%c\n%s\n", board.string.length > 0 ? '1' : '0', base64.UTF8String);
      return 0;
    }
    if (argc == 2 && strcmp(argv[1], "--read-text") == 0) {
      NSData *data = [(board.string ?: @"") dataUsingEncoding:NSUTF8StringEncoding];
      fwrite(data.bytes, 1, data.length, stdout);
      return 0;
    }
    if (argc == 2 && strcmp(argv[1], "--restore") == 0) {
      if (restore_items(board) != 0) { fputs("invalid pasteboard snapshot\n", stderr); return 1; }
      return 0;
    }
    if (argc != 1) {
      fputs("usage: serve-sim-pasteboard [--change-count|--snapshot|--read-text|--restore]\n", stderr);
      return 2;
    }
    NSData *data = [NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile];
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!text) {
      fputs("stdin was not valid UTF-8\n", stderr);
      return 1;
    }

    board.string = text;
    // Exiting immediately after the assignment loses the write.
    [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.25]];
    return 0;
  }
}
