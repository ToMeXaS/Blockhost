// Trimmed real responses from hangar.papermc.io/api/v1 (some version fields edited to cover channels and external links).
export const SEARCH = {
  pagination: {
    count: 3941
  },
  result: [
    {
      name: 'ViaBackwards',
      namespace: {
        owner: 'ViaVersion',
        slug: 'ViaBackwards'
      },
      stats: {
        downloads: 760987
      },
      description:
        'Allow Java Edition clients with older versions to connect to your Minecraft server',
      lastUpdated: '2026-10-21T11:38:01.017295Z',
      avatarUrl: 'https://hangarcdn.papermc.io/avatars/project/12.webp?v=1'
    },
    {
      name: 'ViaVersion',
      namespace: {
        owner: 'ViaVersion',
        slug: 'ViaVersion'
      },
      stats: {
        downloads: 517047
      },
      description:
        'Allow newer Java Edition versions to connect, why lose players after a Minecraft update?',
      lastUpdated: '2026-10-23T08:50:07.239693Z',
      avatarUrl: 'https://hangarcdn.papermc.io/avatars/project/31.webp?v=1'
    }
  ]
}

export const PROJECT = {
  name: 'ViaBackwards',
  namespace: {
    owner: 'ViaVersion',
    slug: 'ViaBackwards'
  },
  stats: {
    downloads: 760993
  },
  description: 'Allow Java Edition clients with older versions to connect to your Minecraft server',
  lastUpdated: '2026-10-21T11:38:01.017295Z',
  avatarUrl: 'https://hangarcdn.papermc.io/avatars/project/12.webp?v=1',
  mainPageContent: null,
  settings: {
    links: [
      {
        id: 0,
        type: 'top',
        title: 'top',
        links: [
          {
            id: 4,
            name: 'Donate',
            url: 'https://github.com/sponsors/kennytv'
          },
          {
            id: 1,
            name: 'Issues',
            url: 'https://github.com/ViaVersion/ViaBackwards/issues'
          },
          {
            id: 2,
            name: 'Source',
            url: 'https://github.com/ViaVersion/ViaBackwards/'
          },
          {
            id: 3,
            name: 'Support',
            url: 'https://discord.gg/viaversion'
          }
        ]
      },
      {
        id: 1,
        type: 'sidebar',
        title: 'Early-Access builds',
        links: [
          {
            id: 0,
            name: 'GitHub Sponsors',
            url: 'https://github.com/sponsors/kennytv/sponsorships?sponsor=kennytv&tier_id=385613&preview=false'
          }
        ]
      }
    ],
    license: {
      name: 'GPL',
      url: 'https://github.com/ViaVersion/ViaBackwards/blob/master/LICENSE',
      type: 'GPL'
    }
  }
}

export const VERSIONS = {
  result: [
    {
      id: 32284,
      name: '5.12.2-SNAPSHOT+662',
      createdAt: '2026-10-21T11:38:01.017295Z',
      channel: {
        name: 'Beta'
      },
      platformDependencies: {
        PAPER: [
          '1.10',
          '1.10.1',
          '1.10.2',
          '1.11',
          '1.11.1',
          '1.11.2',
          '1.12',
          '1.12.1',
          '1.12.2',
          '1.13',
          '1.13.1',
          '1.13.2',
          '1.14',
          '1.14.1',
          '1.14.2',
          '1.14.3',
          '1.14.4',
          '1.15',
          '1.15.1',
          '1.15.2',
          '1.16',
          '1.16.1',
          '1.16.2',
          '1.16.3',
          '1.16.4',
          '1.16.5',
          '1.17',
          '1.17.1',
          '1.18',
          '1.18.1',
          '1.18.2',
          '1.19',
          '1.19.1',
          '1.19.2',
          '1.19.3',
          '1.19.4',
          '1.20',
          '1.20.1',
          '1.20.2',
          '1.20.3',
          '1.20.4',
          '1.20.5',
          '1.20.6',
          '1.21',
          '1.21.1',
          '1.21.10',
          '1.21.11',
          '1.21.2',
          '1.21.3',
          '1.21.4',
          '1.21.5',
          '1.21.6',
          '1.21.7',
          '1.21.8',
          '1.21.9',
          '26.1',
          '26.1.1',
          '26.1.2',
          '26.2',
          '26.3'
        ]
      },
      pluginDependencies: {
        PAPER: [
          {
            name: 'ViaRewind',
            projectId: 112,
            required: false,
            externalUrl: null,
            platform: 'PAPER'
          },
          {
            name: 'ViaVersion',
            projectId: 31,
            required: true,
            externalUrl: null,
            platform: 'PAPER'
          }
        ]
      },
      downloads: {
        PAPER: {
          fileInfo: {
            name: 'ViaBackwards-5.12.2-SNAPSHOT.jar',
            sizeBytes: 1439004,
            sha256Hash: '3f27398657b91d75aee452801b2e75590d99f3cbb526d145c7fce9dbfac9b55a'
          },
          externalUrl: null,
          downloadUrl:
            'https://hangarcdn.papermc.io/plugins/ViaVersion/ViaBackwards/versions/5.12.2-SNAPSHOT%2B662/PAPER/ViaBackwards-5.12.2-SNAPSHOT.jar'
        }
      }
    },
    {
      id: 32283,
      name: '5.12.2-SNAPSHOT+661',
      createdAt: '2026-10-21T11:31:12.208919Z',
      channel: {
        name: 'Release'
      },
      platformDependencies: {
        PAPER: [
          '1.10',
          '1.10.1',
          '1.10.2',
          '1.11',
          '1.11.1',
          '1.11.2',
          '1.12',
          '1.12.1',
          '1.12.2',
          '1.13',
          '1.13.1',
          '1.13.2',
          '1.14',
          '1.14.1',
          '1.14.2',
          '1.14.3',
          '1.14.4',
          '1.15',
          '1.15.1',
          '1.15.2',
          '1.16',
          '1.16.1',
          '1.16.2',
          '1.16.3',
          '1.16.4',
          '1.16.5',
          '1.17',
          '1.17.1',
          '1.18',
          '1.18.1',
          '1.18.2',
          '1.19',
          '1.19.1',
          '1.19.2',
          '1.19.3',
          '1.19.4',
          '1.20',
          '1.20.1',
          '1.20.2',
          '1.20.3',
          '1.20.4',
          '1.20.5',
          '1.20.6',
          '1.21',
          '1.21.1',
          '1.21.10',
          '1.21.11',
          '1.21.2',
          '1.21.3',
          '1.21.4',
          '1.21.5',
          '1.21.6',
          '1.21.7',
          '1.21.8',
          '1.21.9',
          '26.1',
          '26.1.1',
          '26.1.2',
          '26.2',
          '26.3'
        ]
      },
      pluginDependencies: {
        PAPER: [
          {
            name: 'ViaRewind',
            projectId: 112,
            required: false,
            externalUrl: null,
            platform: 'PAPER'
          },
          {
            name: 'ViaVersion',
            projectId: 31,
            required: true,
            externalUrl: null,
            platform: 'PAPER'
          }
        ]
      },
      downloads: {
        PAPER: {
          fileInfo: {
            name: 'ViaBackwards-5.12.2-SNAPSHOT.jar',
            sizeBytes: 1439005,
            sha256Hash: 'c555b73cc49e2473f2dc35df30cc3e52da967c9d93695ad0e44c26d1690212e4'
          },
          externalUrl: null,
          downloadUrl:
            'https://hangarcdn.papermc.io/plugins/ViaVersion/ViaBackwards/versions/5.12.2-SNAPSHOT%2B661/PAPER/ViaBackwards-5.12.2-SNAPSHOT.jar'
        }
      }
    },
    {
      id: 32084,
      name: '5.12.2-SNAPSHOT+660',
      createdAt: '2026-10-18T20:16:01.20547Z',
      channel: {
        name: 'Release'
      },
      platformDependencies: {
        PAPER: [
          '1.10',
          '1.10.1',
          '1.10.2',
          '1.11',
          '1.11.1',
          '1.11.2',
          '1.12',
          '1.12.1',
          '1.12.2',
          '1.13',
          '1.13.1',
          '1.13.2',
          '1.14',
          '1.14.1',
          '1.14.2',
          '1.14.3',
          '1.14.4',
          '1.15',
          '1.15.1',
          '1.15.2',
          '1.16',
          '1.16.1',
          '1.16.2',
          '1.16.3',
          '1.16.4',
          '1.16.5',
          '1.17',
          '1.17.1',
          '1.18',
          '1.18.1',
          '1.18.2',
          '1.19',
          '1.19.1',
          '1.19.2',
          '1.19.3',
          '1.19.4',
          '1.20',
          '1.20.1',
          '1.20.2',
          '1.20.3',
          '1.20.4',
          '1.20.5',
          '1.20.6',
          '1.21',
          '1.21.1',
          '1.21.10',
          '1.21.11',
          '1.21.2',
          '1.21.3',
          '1.21.5',
          '1.21.6',
          '1.21.7',
          '1.21.8',
          '1.21.9',
          '26.1',
          '26.1.1',
          '26.1.2',
          '26.2',
          '26.3'
        ]
      },
      pluginDependencies: {
        PAPER: [
          {
            name: 'LuckPerms',
            projectId: null,
            required: true,
            externalUrl: 'https://luckperms.net/download'
          }
        ]
      },
      downloads: {
        PAPER: {
          fileInfo: null,
          downloadUrl: null,
          externalUrl: 'https://github.com/x/releases'
        }
      }
    }
  ]
}
