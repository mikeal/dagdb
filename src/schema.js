export default
{
  types: {
    HashMapData: {
      kind: 'list',
      valueType: 'Element'
    },
    HashMapRoot: {
      kind: 'struct',
      fields: {
        hashAlg: {
          type: 'String'
        },
        bucketSize: {
          type: 'Int'
        },
        map: {
          type: 'Bytes'
        },
        data: {
          type: 'HashMapData'
        }
      },
      representation: {
        map: {}
      }
    },
    HashMapNode: {
      kind: 'struct',
      fields: {
        map: {
          type: 'Bytes'
        },
        data: {
          type: 'HashMapData'
        }
      },
      representation: {
        map: {}
      }
    },
    Element: {
      kind: 'union',
      representation: {
        kinded: {
          map: 'HashMapNode',
          link: {
            kind: 'link',
            expectedType: 'HashMapNode'
          },
          list: 'Bucket'
        }
      }
    },
    Bucket: {
      kind: 'list',
      valueType: 'BucketEntry'
    },
    BucketEntry: {
      kind: 'struct',
      fields: {
        key: {
          type: 'Bytes'
        },
        value: {
          type: 'Value'
        }
      },
      representation: {
        tuple: {}
      }
    },
    Value: {
      kind: 'union',
      representation: {
        kinded: {
          bool: 'Bool',
          string: 'String',
          bytes: 'Bytes',
          int: 'Int',
          float: 'Float',
          map: 'Map',
          list: 'List',
          link: 'Link'
        }
      }
    },
    DeleteOperation: {
      kind: 'struct',
      fields: {
        key: {
          type: 'String'
        }
      },
      representation: {
        map: {}
      }
    },
    SetOperation: {
      kind: 'struct',
      fields: {
        key: {
          type: 'String'
        },
        val: {
          type: 'Link'
        }
      },
      representation: {
        map: {}
      }
    },
    Operation: {
      kind: 'union',
      representation: {
        keyed: {
          set: 'SetOperation',
          del: 'DeleteOperation'
        }
      }
    },
    OpList: {
      kind: 'list',
      valueType: {
        kind: 'link',
        expectedType: 'Operation'
      }
    },
    TransactionV1: {
      kind: 'struct',
      fields: {
        head: {
          type: {
            kind: 'link',
            expectedType: 'HashMapRoot'
          }
        },
        ops: {
          type: 'OpList'
        },
        prev: {
          type: {
            kind: 'link',
            expectedType: 'Transaction'
          },
          nullable: true
        }
      },
      representation: {
        map: {}
      }
    },
    Transaction: {
      kind: 'union',
      representation: {
        keyed: {
          'kv-v1': 'TransactionV1'
        }
      }
    },
    PropIndex: {
      kind: 'struct',
      fields: {
        count: {
          type: 'int'
        },
        sum: {
          type: 'int'
        },
        map: {
          type: {
            kind: 'link',
            expectedType: 'HashMapRoot'
          }
        }
      },
      representation: {
        map: {}
      }
    },
    Props: {
      kind: 'map',
      keyType: 'String',
      valueType: {
        kind: 'link',
        expectedType: 'PropIndex'
      }
    },
    Indexes: {
      kind: 'struct',
      fields: {
        props: {
          type: {
            kind: 'link',
            expectedType: 'Props'
          }
        }
      },
      representation: {
        map: {}
      }
    },
    DagDBTypeV1: {
      kind: 'union',
      representation: {
        keyed: {
          database: {
            kind: 'link',
            expectedType: 'Database'
          },
          transaction: {
            kind: 'link',
            expectedType: 'Transaction'
          },
          fbl: {
            kind: 'link',
            expectedType: 'FlexibleByteLayout'
          }
        }
      }
    },
    DagDBType: {
      kind: 'union',
      representation: {
        keyed: {
          v1: 'DagDBTypeV1'
        }
      }
    },
    DagDB: {
      kind: 'struct',
      fields: {
        type: {
          type: 'DagDBType'
        }
      },
      representation: {
        map: {
          fields: {
            type: {
              rename: '_dagdb'
            }
          }
        }
      }
    },
    FullMerge: {
      kind: 'bool'
    },
    KeyedMerge: {
      kind: 'string'
    },
    RemoteMergeStrategy: {
      kind: 'union',
      representation: {
        keyed: {
          full: 'FullMerge',
          keyed: 'KeyedMerge'
        }
      }
    },
    RemoteSource: {
      kind: 'struct',
      fields: {
        type: {
          type: 'String'
        }
      },
      representation: {
        map: {}
      }
    },
    RemoteInfo: {
      kind: 'struct',
      fields: {
        strategy: {
          type: 'RemoteMergeStrategy'
        },
        source: {
          type: 'RemoteSource'
        }
      },
      representation: {
        map: {}
      }
    },
    Remote: {
      kind: 'struct',
      fields: {
        info: {
          type: {
            kind: 'link',
            expectedType: 'RemoteInfo'
          }
        },
        head: {
          type: {
            kind: 'link',
            expectedType: 'HashMapRoot'
          }
        },
        merged: {
          type: {
            kind: 'link',
            expectedType: 'HashMapRoot'
          }
        }
      },
      representation: {
        map: {}
      }
    },
    DatabaseV1: {
      kind: 'struct',
      fields: {
        kv: {
          type: {
            kind: 'link',
            expectedType: 'Transaction'
          }
        },
        indexes: {
          type: {
            kind: 'link',
            expectedType: 'Indexes'
          }
        },
        remotes: {
          type: {
            kind: 'link',
            expectedType: 'HashMapRoot'
          }
        }
      },
      representation: {
        map: {}
      }
    },
    Database: {
      kind: 'union',
      representation: {
        keyed: {
          'db-v1': 'DatabaseV1'
        }
      }
    }
  }
}
